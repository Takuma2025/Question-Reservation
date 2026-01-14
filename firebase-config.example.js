/*
  Firebase設定ファイル（サンプル）
  
  【設定方法】
  1. このファイルを「firebase-config.js」としてコピー
  2. https://console.firebase.google.com/ でプロジェクト設定を取得
  3. 下記の値を実際の設定に置き換える
*/

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebase初期化
let firebaseApp = null;
let database = null;

function initFirebase() {
  try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    database = firebase.database();
    console.log('Firebase initialized successfully');
    return true;
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    return false;
  }
}

// Firebase が設定されているかチェック
function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_API_KEY" && 
         firebaseConfig.databaseURL !== "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com";
}
