// === 0. GLOBAL DEĞİŞKENLER ===
let html5QrCode = null; // Barkod okuyucu nesnesi
let currentLiveList = new Map(); // O anki sayım listesi (ProductID -> miktar)
let currentProductLibrary = new Map(); // Ana ürün kütüphanesi (ProductID -> Ürün Bilgisi)
let activeBarcode = null; // Üzerinde çalışılan barkod
let currentUser = null; 
let currentBranchId = null; 
let currentLangData = {}; 

// Firebase Referansları (YENİ MİMARİ)
const productsRef = db.collection("products"); // (ID: prod_123) -> {ad: "Fanta"}
const barcodesRef = db.collection("barcodes"); // (ID: 869...) -> {productId: "prod_123"}
const countsRef = db.collection("counts"); 

// === 1. DİL (i18n) FONKSİYONLARI ===
const languageSwitcher = document.getElementById('language-switcher');
const loginError = document.getElementById('login-error');

function updateUIText() {
    document.querySelectorAll('[data-lang-key]').forEach(element => {
        const key = element.dataset.langKey;
        if (currentLangData[key]) element.textContent = currentLangData[key];
    });
    document.querySelectorAll('[data-lang-key-placeholder]').forEach(element => {
        const key = element.dataset.langKeyPlaceholder;
        if (currentLangData[key]) element.placeholder = currentLangData[key];
    });
    document.querySelector('#app-screen h1').textContent = currentLangData.weeklyCount;
}

async function loadLanguage(lang) {
    try {
        const response = await fetch(`lang/${lang}.json`);
        if (!response.ok) throw new Error("Dil dosyası bulunamadı");
        currentLangData = await response.json();
        updateUIText(); 
        localStorage.setItem('preferredLanguage', lang); 
        languageSwitcher.value = lang; 
        document.documentElement.lang = lang; 
    } catch (error) {
        console.error("Dil yüklenemedi:", error);
        if (lang !== 'de') loadLanguage('de');
    }
}
languageSwitcher.addEventListener('change', (e) => loadLanguage(e.target.value));

function initializeLanguage() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang) {
        loadLanguage(savedLang);
    } else {
        const browserLang = (navigator.language || 'de').split('-')[0];
        loadLanguage(browserLang === 'tr' ? 'tr' : 'de');
    }
}

// === 2. OTURUM YÖNETİMİ (Kalıcı Giriş) ===
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const userInfo = document.getElementById('user-info');

// Giriş Butonu (Sadece girişi dener)
loginButton.addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    auth.signInWithEmailAndPassword(email, pass)
        .catch((error) => {
            loginError.textContent = (currentLangData.loginErrorPrefix || "Error: ") + error.message;
        });
});

// Çıkış Butonu (Sadece çıkışı dener)
logoutButton.addEventListener('click', () => {
    auth.signOut();
});

// ANA OTURUM KONTROLCÜSÜ (Sayfa yenilense bile çalışır)
auth.onAuthStateChanged((user) => {
    if (user) {
        // --- KULLANICI GİRİŞ YAPMIŞ ---
        currentUser = user;
        currentBranchId = user.email.split('@')[0];
        userInfo.textContent = `Şube: ${currentBranchId}`;
        
        loginError.textContent = "";
        loginScreen.style.display = 'none';
        appScreen.style.display = 'block';

        loadProductLibrary(); // Ana ürünleri yükle
        startNewCount(); // Sayımı başlat
        
    } else {
        // --- KULLANICI ÇIKIŞ YAPMIŞ ---
        currentUser = null;
        currentBranchId = null;
        currentLiveList.clear(); 
        currentProductLibrary.clear();
        
        loginScreen.style.display = 'block';
        appScreen.style.display = 'none';

        // Kamerayı (açıksa) güvenle durdur
        if (html5QrCode) {
            try {
                html5QrCode.stop();
                html5QrCode = null;
                document.getElementById('reader-start-button-div').style.display = 'block'; 
            } catch (e) {
                console.warn("Kamera durdurma hatası (normal çıkış):", e);
            }
        }
    }
});

// === 3. ANA UYGULAMA MANTIĞI ===

function startNewCount() {
    currentLiveList.clear();
    updateLiveListUI();
    document.getElementById('report-section').style.display = 'none';
    console.log("Yeni sayım başlatıldı.");
}

// Firebase'den Ana Ürün Kütüphanesini (products) çeker
function loadProductLibrary() {
    productsRef.get().then((querySnapshot) => {
        currentProductLibrary.clear(); 
        querySnapshot.forEach((doc) => {
            // doc.id -> "prod_123" (otomatik ID)
            currentProductLibrary.set(doc.id, doc.data());
        });
        console.log("Ürün kütüphanesi yüklendi:", currentProductLibrary.size, "ürün");
    }).catch(err => console.error("Kütüphane yüklenemedi:", err));
}

// === 4. BARKOD OKUYUCU ===
const startScanButton = document.getElementById('start-scan-button');
const scanResult = document.getElementById('scan-result');

startScanButton.addEventListener('click', () => {
    if (html5QrCode) { // Zaten çalışıyorsa durdur
        try {
            html5QrCode.stop();
            html5QrCode = null;
            startScanButton.textContent = currentLangData.startCamera;
        } catch (err) {
            console.warn("Durdurma hatası:", err);
        }
        return;
    }

    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 5, qrbox: { width: 250, height: 100 } },
        onScanSuccess, 
        (err) => {} // Hataları konsola basma
    ).then(() => {
        startScanButton.parentElement.style.display = 'none';
    }).catch(err => {
        console.error("Kamera başlatılamadı:", err);
        alert("Kamera başlatılamadı: " + err);
    });
});

// === 5. ANA İŞ AKIŞI: BARKOD OKUNDUĞUNDA ===
async function onScanSuccess(decodedText, decodedResult) {
    if (!html5QrCode) return; 
    
    html5QrCode.pause();
    activeBarcode = decodedText;
    scanResult.textContent = `${currentLangData.barcodeScanned || "Okunan:"} ${activeBarcode}`;

    try {
        // 1. ADIM: Barkod Arama Tablosunu (barcodesRef) sorgula
        const barcodeDoc = await barcodesRef.doc(activeBarcode).get();

        if (barcodeDoc.exists) {
            // --- DURUM 1: BİLİNEN BARKOD ---
            const productId = barcodeDoc.data().productId;

            // 2. ADIM: Ana Ürün Kütüphanesinden (productsRef) ürünü çek
            const productDoc = await productsRef.doc(productId).get();
            
            if (!productDoc.exists) {
                alert(`Hata: Barkod (${activeBarcode}) kayıtlı ancak ana ürün (${productId}) kütüphanede bulunamadı!`);
                hideModal(null);
                return;
            }

            const product = productDoc.data();
            
            // 3. ADIM: HATA ÖNLEME (Bu sayımda zaten sayıldı mı? ProductID'ye göre)
            if (currentLiveList.has(productId)) { 
                const existingItem = currentLiveList.get(productId);
                document.getElementById('update-product-name').textContent = existingItem.name;
                document.getElementById('update-product-quantity').textContent = `${existingItem.kasa} ${existingItem.unitName} + ${existingItem.adet} Adet`;
                showModal('update-quantity-modal');
            } else {
                // 4. ADIM: BİLİNEN ÜRÜN MİKTAR GİRİŞİ (Pop-up 1'i aç)
                document.getElementById('save-known-quantity-button').dataset.productId = productId; 
                document.getElementById('known-product-name').textContent = product.name;
                let unitInfo = (currentLangData.unitInfo || "").replace('{unitName}', product.unitName).replace('{multiplier}', product.multiplier);
                document.getElementById('known-product-unit-info').textContent = unitInfo;
                document.getElementById('known-kasa-input').value = 0;
                document.getElementById('known-adet-input').value = 0;
                showModal('known-product-modal');
            }
            
        } else {
            // --- DURUM 2: BİLİNMEYEN BARKOD ---
            // "Yeni Ürün Tanımla" pop-up'ını (Pop-up 2) aç ve formu sıfırla
            document.getElementById('existing-product-search-section').style.display = 'none';
            document.getElementById('new-product-form-section').style.display = 'none';
            document.getElementById('new-product-quantity-section').style.display = 'none';
            document.getElementById('existing-product-search-results').innerHTML = "";
            document.getElementById('choice-existing-product').checked = false;
            document.getElementById('choice-new-product').checked = false;
            document.getElementById('new-product-barcode').textContent = activeBarcode;
            document.getElementById('new-product-name').value = ""; 
            document.getElementById('selected-product-id').value = "";

            // Global API'yi (Open Food Facts) sorgula
            try {
                document.getElementById('new-product-name').value = "API Aranıyor...";
                const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${activeBarcode}.json`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.status === 1 && data.product && data.product.product_name) {
                        document.getElementById('new-product-name').value = data.product.product_name; 
                    } else {
                        document.getElementById('new-product-name').value = "";
                    }
                }
            } catch (e) {
                console.warn("API sorgusu başarısız (normal):", e);
                document.getElementById('new-product-name').value = "";
            }
            
            showModal('new-product-modal');
        }
    } catch (err) {
        console.error("onScanSuccess Hatası:", err);
        alert("Veritabanı hatası: " + err.message);
        hideModal(null); // Kamerayı yeniden aç
    }
}

// === 6. POP-UP (MODAL) YÖNETİMİ ===
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}
function hideModal(modalId) {
    if (modalId) { // Eğer bir ID varsa (örn: "kapat" butonu)
        document.getElementById(modalId).style.display = 'none';
    } else { // Eğer ID yoksa (örn: genel bir hata) tüm modalları kapat
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }
    scanResult.textContent = ""; // Sonucu temizle
    
    // A/B seçeneğini (eğer değiştiyse) sıfırla
    document.getElementById('new-product-choice').style.display = 'block';
    
    // Kamerayı yeniden başlat
    if (html5QrCode && html5QrCode.getState() === 2) { // 2 = PAUSED
        html5QrCode.resume().catch(err => console.warn("Resume hatası", err));
    }
}
document.querySelectorAll('.close-modal').forEach(button => {
    button.addEventListener('click', (e) => hideModal(e.target.closest('.modal').id));
});

// Pop-up 1: Bilinen Ürünü Kaydet
document.getElementById('save-known-quantity-button').addEventListener('click', (e) => {
    const productId = e.target.dataset.productId; 
    const product = currentProductLibrary.get(productId); 
    
    if (!product) {
        alert("Kritik Hata: Ürün ID'si kütüphanede bulunamadı.");
        return;
    }
    
    const kasa = parseInt(document.getElementById('known-kasa-input').value) || 0;
    const adet = parseInt(document.getElementById('known-adet-input').value) || 0;

    const itemData = {
        ...product, // Kategori, ad, çarpan vb. tüm bilgileri kopyala
        kasa: kasa,
        adet: adet,
        totalAdet: (kasa * product.multiplier) + adet
    };
    
    currentLiveList.set(productId, itemData); 
    updateLiveListUI();
    hideModal('known-product-modal');
});

// Pop-up 2: Yeni Ürünü Kaydet (A/B Senaryoları)
document.getElementById('save-new-product-button').addEventListener('click', async () => {
    const choice = document.querySelector('input[name="productChoice"]:checked');
    if (!choice) {
        alert("Lütfen bu barkodun yeni bir ürün mü yoksa mevcut bir ürünün yeni barkodu mu olduğunu seçin.");
        return;
    }

    const kasa = parseInt(document.getElementById('new-kasa-input').value) || 0;
    const adet = parseInt(document.getElementById('new-adet-input').value) || 0;
    
    let productIdToSave;
    let productDataForList;

    try {
        if (choice.value === 'existing') {
            // --- SENARYO A: MEVCUT ÜRÜNE BAĞLA ---
            productIdToSave = document.getElementById('selected-product-id').value;
            if (!productIdToSave) {
                alert("Lütfen arama yaparak mevcut bir ürün seçin.");
                return;
            }
            await barcodesRef.doc(activeBarcode).set({ productId: productIdToSave });
            productDataForList = currentProductLibrary.get(productIdToSave);

        } else if (choice.value === 'new') {
            // --- SENARYO B: TAMAMEN YENİ ÜRÜN OLUŞTUR ---
            const productData = {
                name: document.getElementById('new-product-name').value.trim(),
                category: document.getElementById('new-product-category').value,
                unitName: document.getElementById('new-product-unit-name').value,
                multiplier: parseInt(document.getElementById('new-product-multiplier').value) || 1
            };
            if (!productData.name) {
                alert("Ürün adı boş olamaz!");
                return;
            }

            const newProductDoc = await productsRef.add(productData);
            productIdToSave = newProductDoc.id;
            await barcodesRef.doc(activeBarcode).set({ productId: productIdToSave });

            currentProductLibrary.set(productIdToSave, productData);
            productDataForList = productData;
        }

        // 3. (SON ADIM): Ürünü canlı listeye ekle
        const itemData = {
            ...productDataForList,
            kasa: kasa,
            adet: adet,
            totalAdet: (kasa * productDataForList.multiplier) + adet
        };
        
        currentLiveList.set(productIdToSave, itemData);
        updateLiveListUI();
        hideModal('new-product-modal');

    } catch (err) {
        console.error("Firebase kayıt hatası:", err);
        alert("Hata: Ürün kaydedilemedi. " + err.message);
    }
});

// Pop-up 3: Miktar Güncellemeyi Onayla
document.getElementById('update-quantity-confirm-button').addEventListener('click', () => {
    // "Miktarı Güncelle" dendi. Hangi ürünün güncelleneceğini bilmeliyiz.
    // 'activeBarcode' kullanarak 'productId'yi tekrar bulmamız lazım.
    barcodesRef.doc(activeBarcode).get().then(doc => {
        if(doc.exists) {
            const productId = doc.data().productId;
            const product = currentProductLibrary.get(productId);
            const existingItem = currentLiveList.get(productId);

            hideModal('update-quantity-modal');
            
            document.getElementById('save-known-quantity-button').dataset.productId = productId;
            document.getElementById('known-product-name').textContent = product.name;
            let unitInfo = (currentLangData.unitInfo || "").replace('{unitName}', product.unitName).replace('{multiplier}', product.multiplier);
            document.getElementById('known-product-unit-info').textContent = unitInfo;
            document.getElementById('known-kasa-input').value = existingItem.kasa;
            document.getElementById('known-adet-input').value = existingItem.adet;
            
            showModal('known-product-modal');
        }
    });
});

// === 7. YENİ ÜRÜN POP-UP YARDIMCILARI ===
const existingProductSearchSection = document.getElementById('existing-product-search-section');
const newProductFormSection = document.getElementById('new-product-form-section');
const newProductQuantitySection = document.getElementById('new-product-quantity-section');
const existingProductSearchInput = document.getElementById('existing-product-search-input');
const existingProductSearchResults = document.getElementById('existing-product-search-results');
const selectedProductIdInput = document.getElementById('selected-product-id');

// Seçenek A (Mevcut Ürün) tıklandığında
document.getElementById('choice-existing-product').addEventListener('change', () => {
    existingProductSearchSection.style.display = 'block';
    newProductFormSection.style.display = 'none';
    newProductQuantitySection.style.display = 'block';
});

// Seçenek B (Yeni Ürün) tıklandığında
document.getElementById('choice-new-product').addEventListener('change', () => {
    existingProductSearchSection.style.display = 'none';
    newProductFormSection.style.display = 'block';
    newProductQuantitySection.style.display = 'block';
});

// Mevcut ürünler kütüphanesinde arama
existingProductSearchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    existingProductSearchResults.innerHTML = ""; 
    selectedProductIdInput.value = ""; 
    
    if (searchTerm.length < 2) return; 

    currentProductLibrary.forEach((product, productId) => {
        if (product.name.toLowerCase().includes(searchTerm)) {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = product.name;
            
            div.addEventListener('click', () => {
                existingProductSearchInput.value = product.name; 
                selectedProductIdInput.value = productId; // Gizli ID'yi ayarla
                existingProductSearchResults.innerHTML = ""; 
            });
            existingProductSearchResults.appendChild(div);
        }
    });
});

// === 8. BARKODSUZ YENİ ÜRÜN TANIMLAMA (Manuel) ===
document.getElementById('show-manual-define-button').addEventListener('click', () => {
    activeBarcode = "MANUAL_" + new Date().getTime(); 
    document.getElementById('new-product-barcode').textContent = currentLangData.defineNewManual || "Manuel Giriş";
    
    // A/B Seçeneklerini gizle, direkt "Yeni Ürün Formu"nu göster
    document.getElementById('new-product-choice').style.display = 'none';
    document.getElementById('existing-product-search-section').style.display = 'none';
    document.getElementById('new-product-form-section').style.display = 'block';
    document.getElementById('new-product-quantity-section').style.display = 'block';

    // Formu temizle
    document.getElementById('new-product-name').value = "";
    document.getElementById('new-product-multiplier').value = 1;
    document.getElementById('new-kasa-input').value = 0; 
    document.getElementById('new-adet-input').value = 0;
    
    // "Seçenek B"yi (Yeni Ürün) bizim için otomatik seçili hale getir
    document.getElementById('choice-new-product').checked = true;
    
    showModal('new-product-modal');
});

// === 9. CANLI LİSTE ARAYÜZÜ ===
const liveScanListUI = document.getElementById('live-scan-list');

function updateLiveListUI() {
    liveScanListUI.innerHTML = ""; 
    
    currentLiveList.forEach((item, productId) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${item.name}</strong>: ${item.kasa} ${item.unitName} + ${item.adet} Adet
            <button class="delete-item-button" data-product-id="${productId}">X</button>
        `;
        liveScanListUI.appendChild(li);
    });
    
    document.querySelectorAll('.delete-item-button').forEach(button => {
        button.addEventListener('click', (e) => {
            currentLiveList.delete(e.target.dataset.productId); // ProductID'ye göre sil
            updateLiveListUI();
        });
    });
}

// === 10. RAPORLAMA FONKSİYONLARI ===
const finishScanButton = document.getElementById('finish-scan-button');
const reportSection = document.getElementById('report-section');
const reportListCurrent = document.getElementById('report-list-current');
const filterButton = document.getElementById('filter-button');
const reportListFiltered = document.getElementById('report-list-filtered');

finishScanButton.addEventListener('click', () => {
    if (currentLiveList.size === 0) {
        alert("Hiç ürün sayılmadı."); // TODO: Dil dosyasına ekle
        return;
    }
    
    reportListCurrent.innerHTML = "";
    const sortedList = [...currentLiveList.values()].sort((a, b) => b.totalAdet - a.totalAdet);

    sortedList.forEach(item => {
        const li = document.createElement('li');
        li.textContent = `(${item.totalAdet} Toplam) ${item.name}: ${item.kasa} ${item.unitName} + ${item.adet} Adet`;
        reportListCurrent.appendChild(li);
    });

    reportSection.style.display = 'block';
});

filterButton.addEventListener('click', () => {
    const filterValue = parseInt(document.getElementById('filter-input').value);
    
    const filteredItems = [...currentLiveList.values()]
        .filter(item => item.totalAdet <= filterValue)
        .sort((a, b) => a.totalAdet - b.totalAdet);

    const groupedByCategory = {};
    filteredItems.forEach(item => {
        const category = item.category || "Diğer";
        if (!groupedByCategory[category]) groupedByCategory[category] = [];
        groupedByCategory[category].push(item);
    });

    reportListFiltered.innerHTML = "";
    for (const category in groupedByCategory) {
        const categoryDiv = document.createElement('div');
        categoryDiv.innerHTML = `<h4>${category}</h4>`;
        const ul = document.createElement('ul');
        groupedByCategory[category].forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.name} (Mevcut: ${item.kasa} ${item.unitName} + ${item.adet} Adet)`;
            ul.appendChild(li);
        });
        categoryDiv.appendChild(ul);
        reportListFiltered.appendChild(categoryDiv);
    }
});

// === UYGULAMAYI BAŞLAT ===
initializeLanguage();