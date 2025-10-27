// === 0. GLOBAL DEĞİŞKENLER ===
let html5QrCode = null; // Barkod okuyucu nesnesi
let currentLiveList = new Map(); // O anki sayım listesi (barkod -> miktar)
let currentProductLibrary = new Map(); // Firebase'den çekilen ürün kütüphanesi (barkod -> ürün bilgisi)
let activeBarcode = null; // Üzerinde çalışılan barkod (pop-up'lar için)
let currentUser = null; // Giriş yapan kullanıcı
let currentBranchId = null; // Giriş yapan şube kimliği

// Dil verisi
let currentLangData = {}; 

// Firebase Referansları
const productsRef = db.collection("products"); // Global Ürün Kütüphanesi
const countsRef = db.collection("counts"); // Şube Sayım Raporları

// === 1. DİL (i18n) FONKSİYONLARI ===
const languageSwitcher = document.getElementById('language-switcher');
const loginError = document.getElementById('login-error');

// Sayfadaki tüm metinleri JSON'a göre günceller
function updateUIText() {
    document.querySelectorAll('[data-lang-key]').forEach(element => {
        const key = element.dataset.langKey;
        if (currentLangData[key]) {
            element.textContent = currentLangData[key];
        }
    });
    // Placeholder'ları da güncelle
    document.querySelectorAll('[data-lang-key-placeholder]').forEach(element => {
        const key = element.dataset.langKeyPlaceholder;
        if (currentLangData[key]) {
            element.placeholder = currentLangData[key];
        }
    });
    // HTML dışındaki dinamik başlık
    document.querySelector('#app-screen h1').textContent = currentLangData.weeklyCount;
}

// JSON dosyasını yükler ve dili ayarlar
async function loadLanguage(lang) {
    try {
        const response = await fetch(`lang/${lang}.json`);
        if (!response.ok) throw new Error("Dil dosyası bulunamadı");
        
        currentLangData = await response.json();
        updateUIText(); // Arayüzü güncelle
        localStorage.setItem('preferredLanguage', lang); // Seçimi hafızaya al
        languageSwitcher.value = lang; // Select kutusunu ayarla
        document.documentElement.lang = lang; // HTML lang etiketini güncelle
    } catch (error) {
        console.error("Dil yüklenemedi:", error);
        if (lang !== 'de') loadLanguage('de'); // Hata olursa Almanca'ya dön
    }
}

// Dil seçim kutusu değiştiğinde
languageSwitcher.addEventListener('change', (e) => loadLanguage(e.target.value));

// Başlangıçta dili otomatik algıla
function initializeLanguage() {
    const savedLang = localStorage.getItem('preferredLanguage');
    if (savedLang) {
        loadLanguage(savedLang);
    } else {
        const browserLang = (navigator.language || 'de').split('-')[0];
        loadLanguage(browserLang === 'tr' ? 'tr' : 'de'); // Varsayılan Almanca
    }
}

// === 2. GİRİŞ (AUTHENTICATION) FONKSİYONLARI ===
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');
const userInfo = document.getElementById('user-info');

// Giriş Butonu
loginButton.addEventListener('click', () => {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    
    auth.signInWithEmailAndPassword(email, pass)
        .then((userCredential) => {
            currentUser = userCredential.user;
            currentBranchId = email.split('@')[0]; // Şube kimliği (örn: "sube.a")
            userInfo.textContent = `Şube: ${currentBranchId}`;
            
            loginScreen.style.display = 'none';
            appScreen.style.display = 'block';
            
            loadProductLibrary(); // Giriş yapınca ürün kütüphanesini yükle
            startNewCount(); // Yeni sayım listesini hazırla
        })
        .catch((error) => {
            loginError.textContent = (currentLangData.loginErrorPrefix || "Error: ") + error.message;
        });
});

// Çıkış Butonu
logoutButton.addEventListener('click', () => {
    auth.signOut().then(() => {
        currentUser = null;
        currentBranchId = null;
        currentLiveList.clear();
        currentProductLibrary.clear();
        
        loginScreen.style.display = 'block';
        appScreen.style.display = 'none';
    });
});

// === 3. ANA UYGULAMA MANTIĞI ===

// Yeni sayımı başlatır
function startNewCount() {
    currentLiveList.clear();
    updateLiveListUI();
    document.getElementById('report-section').style.display = 'none';
    console.log("Yeni sayım başlatıldı.");
}

// Firebase'den Global Ürün Kütüphanesini çeker
function loadProductLibrary() {
    productsRef.get().then((querySnapshot) => {
        currentProductLibrary.clear(); // Önce yereli temizle
        querySnapshot.forEach((doc) => {
            // doc.id barkod numarasıdır
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
        html5QrCode.stop().catch(err => console.warn("Durdurma hatası:", err));
        html5QrCode = null;
        startScanButton.textContent = currentLangData.startCamera;
        return;
    }

    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" }, 
        { fps: 5, qrbox: { width: 250, height: 100 } },
        onScanSuccess, 
        (err) => {} // Hata mesajlarını gösterme
    ).then(() => {
        startScanButton.parentElement.style.display = 'none';
    }).catch(err => console.error("Kamera başlatılamadı:", err));
});

// !!! PROJENİN KALBİ: BARKOD OKUNDUĞUNDA !!!
function onScanSuccess(decodedText, decodedResult) {
    if (!html5QrCode) return; // Okuyucu kapalıysa işlem yapma
    
    html5QrCode.pause();
    activeBarcode = decodedText;
    scanResult.textContent = `${currentLangData.barcodeScanned || "Okunan:"} ${activeBarcode}`;

    // 1. ADIM: HATA ÖNLEME (Bu sayımda zaten okutuldu mu?)
    if (currentLiveList.has(activeBarcode)) {
        const existingItem = currentLiveList.get(activeBarcode);
        document.getElementById('update-product-name').textContent = existingItem.name;
        document.getElementById('update-product-quantity').textContent = `${existingItem.kasa} ${existingItem.unitName} + ${existingItem.adet} Adet`;
        showModal('update-quantity-modal');
        return;
    }

    // 2. ADIM: ÜRÜN TANIMA (Global kütüphanede var mı?)
    if (currentProductLibrary.has(activeBarcode)) {
        const product = currentProductLibrary.get(activeBarcode);
        document.getElementById('known-product-name').textContent = product.name;
        
        let unitInfo = currentLangData.unitInfo || "(Birim: {unitName} ({multiplier}'li))";
        unitInfo = unitInfo.replace('{unitName}', product.unitName).replace('{multiplier}', product.multiplier);
        document.getElementById('known-product-unit-info').textContent = unitInfo;
        
        document.getElementById('known-kasa-input').value = 0;
        document.getElementById('known-adet-input').value = 0;
        showModal('known-product-modal');
    } 
    // 3. ADIM: YENİ ÜRÜN (İlk defa görülüyor)
    else {
        document.getElementById('new-product-barcode').textContent = activeBarcode;
        document.getElementById('new-product-name').value = ""; // (API sorgusu buraya eklenebilir)
        
        // Formu temizle
        document.getElementById('new-product-category').value = "Diğer";
        document.getElementById('new-product-unit-name').value = "";
        document.getElementById('new-product-multiplier').value = 1;
        document.getElementById('new-kasa-input').value = 0;
        document.getElementById('new-adet-input').value = 0;
        
        showModal('new-product-modal');
    }
}

// === 5. POP-UP (MODAL) YÖNETİMİ ===
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}
function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    scanResult.textContent = ""; // Sonucu temizle
    // Kamerayı yeniden başlat
    if (html5QrCode && html5QrCode.getState() === 2) { // 2 = PAUSED
        html5QrCode.resume().catch(err => console.warn("Resume hatası", err));
    }
}
document.querySelectorAll('.close-modal').forEach(button => {
    button.addEventListener('click', (e) => hideModal(e.target.closest('.modal').id));
});

// Pop-up 1: Bilinen Ürünü Kaydetme
document.getElementById('save-known-quantity-button').addEventListener('click', () => {
    const product = currentProductLibrary.get(activeBarcode);
    const kasa = parseInt(document.getElementById('known-kasa-input').value) || 0;
    const adet = parseInt(document.getElementById('known-adet-input').value) || 0;

    const itemData = {
        name: product.name,
        category: product.category,
        unitName: product.unitName,
        multiplier: product.multiplier,
        kasa: kasa,
        adet: adet,
        totalAdet: (kasa * product.multiplier) + adet
    };
    
    currentLiveList.set(activeBarcode, itemData);
    updateLiveListUI();
    hideModal('known-product-modal');
});

// Pop-up 2: Yeni Ürünü Kaydetme
document.getElementById('save-new-product-button').addEventListener('click', () => {
    const productData = {
        name: document.getElementById('new-product-name').value.trim(),
        category: document.getElementById('new-product-category').value,
        unitName: document.getElementById('new-product-unit-name').value.trim() || "Stk", // Stk = Stück
        multiplier: parseInt(document.getElementById('new-product-multiplier').value) || 1
    };
    if (!productData.name) {
        alert("Ürün adı boş olamaz!");
        return;
    }

    // 1. Firebase'e (Global Kütüphane) kaydet
    productsRef.doc(activeBarcode).set(productData)
        .then(() => {
            console.log("Yeni ürün Firebase'e kaydedildi.");
            currentProductLibrary.set(activeBarcode, productData); // Yerel kütüphaneye de ekle

            // 2. Miktarı al ve canlı listeye ekle
            const kasa = parseInt(document.getElementById('new-kasa-input').value) || 0;
            const adet = parseInt(document.getElementById('new-adet-input').value) || 0;

            const itemData = {
                ...productData,
                kasa: kasa,
                adet: adet,
                totalAdet: (kasa * productData.multiplier) + adet
            };

            currentLiveList.set(activeBarcode, itemData);
            updateLiveListUI();
            hideModal('new-product-modal');
        })
        .catch(err => console.error("Firebase kayıt hatası:", err));
});

// Pop-up 3: Miktar Güncellemeyi Onayla
document.getElementById('update-quantity-confirm-button').addEventListener('click', () => {
    hideModal('update-quantity-modal');
    
    const product = currentProductLibrary.get(activeBarcode);
    const existingItem = currentLiveList.get(activeBarcode);

    // Bilinen ürün pop-up'ını, eski verilerle doldurarak aç
    document.getElementById('known-product-name').textContent = product.name;
    let unitInfo = currentLangData.unitInfo || "(Birim: {unitName} ({multiplier}'li))";
    unitInfo = unitInfo.replace('{unitName}', product.unitName).replace('{multiplier}', product.multiplier);
    document.getElementById('known-product-unit-info').textContent = unitInfo;
    
    document.getElementById('known-kasa-input').value = existingItem.kasa;
    document.getElementById('known-adet-input').value = existingItem.adet;
    
    showModal('known-product-modal'); // Miktarı girmesi için yeniden aç
});

// === 6. MANUEL EKLEME (Depoda Yoksa) ===
// (Bu kısım için kütüphanedeki ürünleri aratıp, 0 olarak ekleme fonksiyonu eklenecek)
// Şimdilik basitçe:
document.getElementById('manual-search-input').addEventListener('change', (e) => {
    const productName = e.target.value.trim();
    if (!productName) return;

    // Kütüphanede bu isimde bir ürün ara (basit arama)
    let found = null;
    let foundBarcode = null;
    for (const [barcode, product] of currentProductLibrary.entries()) {
        if (product.name.toLowerCase().includes(productName.toLowerCase())) {
            found = product;
            foundBarcode = barcode;
            break;
        }
    }

    if (found && !currentLiveList.has(foundBarcode)) {
        if (confirm(`"${found.name}" ürünü depoda yok olarak (0) eklensin mi?`)) {
            const itemData = {
                ...found,
                kasa: 0,
                adet: 0,
                totalAdet: 0
            };
            currentLiveList.set(foundBarcode, itemData);
            updateLiveListUI();
            e.target.value = ""; // Arama kutusunu temizle
        }
    } else if (currentLiveList.has(foundBarcode)) {
        alert("Bu ürün zaten sayıldı.");
    } else {
        alert("Ürün kütüphanede bulunamadı. Lütfen önce depoda bularak okutun.");
    }
});


// === 7. CANLI LİSTE ARAYÜZÜ ===
const liveScanListUI = document.getElementById('live-scan-list');

function updateLiveListUI() {
    liveScanListUI.innerHTML = ""; // Listeyi temizle
    
    currentLiveList.forEach((item, barcode) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${item.name}</strong>: ${item.kasa} ${item.unitName} + ${item.adet} Adet
            <button class="delete-item-button" data-barcode="${barcode}">X</button>
        `;
        liveScanListUI.appendChild(li);
    });
    
    // Sil butonlarına olay ekle
    document.querySelectorAll('.delete-item-button').forEach(button => {
        button.addEventListener('click', (e) => {
            currentLiveList.delete(e.target.dataset.barcode);
            updateLiveListUI();
        });
    });
}

// === 8. RAPORLAMA FONKSİYONLARI ===
const finishScanButton = document.getElementById('finish-scan-button');
const reportSection = document.getElementById('report-section');
const reportListCurrent = document.getElementById('report-list-current');
const filterButton = document.getElementById('filter-button');
const reportListFiltered = document.getElementById('report-list-filtered');

finishScanButton.addEventListener('click', () => {
    if (currentLiveList.size === 0) {
        alert("Hiç ürün sayılmadı.");
        return;
    }
    
    // Rapor 1: Mevcut Durum (Çoktan Aza)
    reportListCurrent.innerHTML = "";
    const sortedList = [...currentLiveList.values()].sort((a, b) => b.totalAdet - a.totalAdet);

    sortedList.forEach(item => {
        const li = document.createElement('li');
        li.textContent = `(${item.totalAdet} Toplam) ${item.name}: ${item.kasa} ${item.unitName} + ${item.adet} Adet`;
        reportListCurrent.appendChild(li);
    });

    reportSection.style.display = 'block';
});

// Filtrele Butonu
filterButton.addEventListener('click', () => {
    const filterValue = parseInt(document.getElementById('filter-input').value);
    
    const filteredItems = [...currentLiveList.values()]
        .filter(item => item.totalAdet <= filterValue)
        .sort((a, b) => a.totalAdet - b.totalAdet); // Azdan Çoğa

    // Kategorilere göre grupla
    const groupedByCategory = {};
    filteredItems.forEach(item => {
        const category = item.category || "Diğer";
        if (!groupedByCategory[category]) {
            groupedByCategory[category] = [];
        }
        groupedByCategory[category].push(item);
    });

    // HTML'i oluştur
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
initializeLanguage(); // Sayfa ilk açıldığında dili yükle