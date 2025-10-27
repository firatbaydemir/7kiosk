const firebaseConfig = {
    apiKey: "AIzaSyDiJ28SOe_9lg0mtMSsbhrP7jfbbRw5k-0",
    authDomain: "kiosk-a4014.firebaseapp.com",
    projectId: "kiosk-a4014",
    storageBucket: "kiosk-a4014.firebasestorage.app",
    messagingSenderId: "342656071523",
    appId: "1:342656071523:web:b41995a2e1a37a0d784556",
    measurementId: "G-YBZX96NK3H"
  };

// BU DOĞRU KOD
var app = firebase.initializeApp(firebaseConfig);
var auth = firebase.auth(app);
var db = firebase.firestore(app);