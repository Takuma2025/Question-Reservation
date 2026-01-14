/*
  Firebase設定ファイル
  
  【設定方法】
  1. https://console.firebase.google.com/ にアクセス
  2. 「プロジェクトを追加」でプロジェクトを作成
  3. 左メニュー「Realtime Database」→「データベースを作成」
  4. 「テストモードで開始」を選択
  5. プロジェクト設定 → 全般 → 「ウェブアプリを追加」
  6. 下記の firebaseConfig を取得した値に置き換える
  
  【セキュリティルール（本番用）】
  Realtime Database → ルール で以下を設定:
  {
    "rules": {
      ".read": true,
      ".write": true
    }
  }
*/

const firebaseConfig = {
  apiKey: "AIzaSyADRvA1I8jK7_HLerWr_e2TfCq-0saFGV4",
  authDomain: "question-reservation.firebaseapp.com",
  databaseURL: "https://question-reservation-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "question-reservation",
  storageBucket: "question-reservation.firebasestorage.app",
  messagingSenderId: "523122800307",
  appId: "1:523122800307:web:b1cd137884eeb9aab6a2c6"
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
