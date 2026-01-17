/*
  質問受付予約Web - app.js
  アプリケーションのロジックを管理。
  - ルーティング（URLハッシュベース）
  - データ管理（Firebase Realtime Database + localStorage フォールバック）
  - 生徒・先生ログイン機能
  - 生徒管理機能（先生用）
  - 生徒画面の入力・保存・送信処理
  - 先生画面の一覧・詳細・完了処理
  - トースト通知
  - 複数画像の添付対応
*/

// ============================================
// Constants
// ============================================
const STORAGE_KEY = 'question_tickets_v1';
const STUDENTS_KEY = 'question_students_v1';
const USER_PREFS_KEY = 'question_user_prefs';
const STUDENT_SESSION_KEY = 'question_student_session';
const TEACHER_SESSION_KEY = 'question_teacher_session';
const TEACHER_PASSWORD_KEY = 'question_teacher_password';
const MAX_TICKETS_PER_STUDENT = 3;
const DEFAULT_TEACHER_PASSWORD = '066';

// ============================================
// Firebase Data Cache
// ============================================
let ticketsCache = [];
let studentsCache = [];
let firebaseReady = false;
let dataLoadedCallbacks = [];

/**
 * Firebase初期化とリアルタイムリスナー設定
 */
function initializeFirebaseData() {
  const loadingScreen = document.getElementById('loading-screen');
  
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured. Using localStorage fallback.');
    ticketsCache = loadTicketsFromLocal();
    studentsCache = loadStudentsFromLocal();
    firebaseReady = true;
    if (loadingScreen) loadingScreen.classList.add('hidden');
    triggerDataLoadedCallbacks();
    return;
  }
  
  if (!initFirebase()) {
    console.error('Firebase initialization failed. Using localStorage fallback.');
    ticketsCache = loadTicketsFromLocal();
    studentsCache = loadStudentsFromLocal();
    firebaseReady = true;
    if (loadingScreen) loadingScreen.classList.add('hidden');
    triggerDataLoadedCallbacks();
    return;
  }
  
  // チケットのリアルタイムリスナー
  database.ref('tickets').on('value', (snapshot) => {
    const data = snapshot.val();
    ticketsCache = data ? Object.values(data) : [];
    console.log('Tickets synced:', ticketsCache.length);
    if (firebaseReady) {
      refreshCurrentView();
    }
  }, (error) => {
    console.error('Tickets sync error:', error);
  });
  
  // 生徒のリアルタイムリスナー
  database.ref('students').on('value', (snapshot) => {
    const data = snapshot.val();
    studentsCache = data ? Object.values(data) : [];
    console.log('Students synced:', studentsCache.length);
    if (firebaseReady) {
      refreshCurrentView();
    }
  }, (error) => {
    console.error('Students sync error:', error);
  });
  
  // 先生パスワードの同期
  loadTeacherPasswordFromFirebase();
  
  // 初回データ読み込み完了を待つ
  Promise.all([
    database.ref('tickets').once('value'),
    database.ref('students').once('value')
  ]).then(() => {
    firebaseReady = true;
    console.log('Firebase data loaded');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    triggerDataLoadedCallbacks();
  }).catch((error) => {
    console.error('Firebase data load error:', error);
    ticketsCache = loadTicketsFromLocal();
    studentsCache = loadStudentsFromLocal();
    firebaseReady = true;
    if (loadingScreen) loadingScreen.classList.add('hidden');
    triggerDataLoadedCallbacks();
  });
}

/**
 * データ読み込み完了時のコールバック実行
 */
function triggerDataLoadedCallbacks() {
  dataLoadedCallbacks.forEach(cb => cb());
  dataLoadedCallbacks = [];
}

/**
 * データ読み込み完了を待つ
 */
function waitForData(callback) {
  if (firebaseReady) {
    callback();
  } else {
    dataLoadedCallbacks.push(callback);
  }
}

/**
 * 現在の画面を更新（リアルタイム同期用）
 */
function refreshCurrentView() {
  const hash = location.hash || '#';
  if (hash === '#student-mypage') {
    renderStudentMyPage();
  } else if (hash === '#teacher') {
    renderTeacherTickets();
  } else if (hash.startsWith('#teacher-detail')) {
    const id = new URLSearchParams(hash.split('?')[1]).get('id');
    if (id) renderTeacherDetail(id);
  } else if (hash === '#teacher-students') {
    renderTeacherStudentsList();
  }
}

// ============================================
// Data Management - Tickets
// ============================================

/**
 * localStorageからチケット読み込み（フォールバック用）
 */
function loadTicketsFromLocal() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load tickets from localStorage:', e);
    return [];
  }
}

/**
 * チケット一覧を取得（キャッシュから）
 */
function loadTickets() {
  return ticketsCache;
}

/**
 * チケットを追加または更新する
 */
async function upsertTicket(ticket) {
  const now = Date.now();
  const existingIndex = ticketsCache.findIndex(t => t.id === ticket.id);
  
  if (existingIndex >= 0) {
    ticket = { ...ticketsCache[existingIndex], ...ticket, updatedAt: now };
  } else {
    ticket = { ...ticket, createdAt: now, updatedAt: now };
  }
  
  if (isFirebaseConfigured() && database) {
    try {
      await database.ref('tickets/' + ticket.id).set(ticket);
    } catch (error) {
      console.error('Failed to save ticket to Firebase:', error);
      showToast('保存に失敗しました', 'error');
      throw error;
    }
  } else {
    if (existingIndex >= 0) {
      ticketsCache[existingIndex] = ticket;
    } else {
      ticketsCache.push(ticket);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ticketsCache));
  }
  
  return ticket;
}

/**
 * IDでチケットを取得する
 */
function getTicketById(id) {
  return ticketsCache.find(t => t.id === id) || null;
}

/**
 * 簡易UUID生成
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 生徒の未完了チケット数を取得
 */
function getActiveTicketCount(studentId, excludeId = null) {
  return ticketsCache.filter(t => 
    t.studentId === studentId && 
    t.status === 'submitted' &&
    t.id !== excludeId
  ).length;
}

// ============================================
// Data Management - Students
// ============================================

/**
 * localStorageから生徒読み込み（フォールバック用）
 */
function loadStudentsFromLocal() {
  try {
    const data = localStorage.getItem(STUDENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load students from localStorage:', e);
    return [];
  }
}

/**
 * 生徒一覧を取得（キャッシュから）
 */
function loadStudents() {
  return studentsCache;
}

/**
 * 生徒を追加または更新する
 */
async function upsertStudent(student) {
  const existingIndex = studentsCache.findIndex(s => s.id === student.id);
  
  if (existingIndex < 0 && !student.id) {
    student.id = generateUUID();
  }
  
  if (isFirebaseConfigured() && database) {
    try {
      await database.ref('students/' + student.id).set(student);
    } catch (error) {
      console.error('Failed to save student to Firebase:', error);
      showToast('保存に失敗しました', 'error');
      throw error;
    }
  } else {
    if (existingIndex >= 0) {
      studentsCache[existingIndex] = { ...studentsCache[existingIndex], ...student };
    } else {
      studentsCache.push(student);
    }
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(studentsCache));
  }
  
  return student;
}

/**
 * 生徒を削除する
 */
async function deleteStudent(studentId) {
  if (isFirebaseConfigured() && database) {
    try {
      await database.ref('students/' + studentId).remove();
    } catch (error) {
      console.error('Failed to delete student from Firebase:', error);
      showToast('削除に失敗しました', 'error');
      throw error;
    }
  } else {
    studentsCache = studentsCache.filter(s => s.id !== studentId);
    localStorage.setItem(STUDENTS_KEY, JSON.stringify(studentsCache));
  }
}

/**
 * IDで生徒を取得する
 */
function getStudentById(id) {
  return studentsCache.find(s => s.id === id) || null;
}

/**
 * クラス・イニシャル・誕生日で生徒を検索
 */
function findStudent(className, initials, birthday) {
  return studentsCache.find(s => 
    s.className === className && 
    s.initials.toUpperCase() === initials.toUpperCase() && 
    s.birthday === birthday
  ) || null;
}

// ============================================
// User Preferences
// ============================================

/**
 * ユーザー設定を読み込む
 */
function loadUserPrefs() {
  try {
    const data = localStorage.getItem(USER_PREFS_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

/**
 * ユーザー設定を保存する
 */
function saveUserPrefs(prefs) {
  try {
    localStorage.setItem(USER_PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save user prefs:', e);
  }
}

// ============================================
// Teacher Password Management
// ============================================

let teacherPasswordCache = null;

/**
 * 先生パスワードを取得
 */
function getTeacherPassword() {
  if (teacherPasswordCache !== null) {
    return teacherPasswordCache;
  }
  
  // Firebaseから取得を試みる（キャッシュがない場合はlocalStorageから）
  const localPassword = localStorage.getItem(TEACHER_PASSWORD_KEY);
  teacherPasswordCache = localPassword || DEFAULT_TEACHER_PASSWORD;
  return teacherPasswordCache;
}

/**
 * 先生パスワードを設定
 */
async function setTeacherPassword(newPassword) {
  if (isFirebaseConfigured() && database) {
    try {
      await database.ref('settings/teacherPassword').set(newPassword);
    } catch (error) {
      console.error('Failed to save password to Firebase:', error);
    }
  }
  localStorage.setItem(TEACHER_PASSWORD_KEY, newPassword);
  teacherPasswordCache = newPassword;
}

/**
 * Firebaseから先生パスワードを読み込む
 */
function loadTeacherPasswordFromFirebase() {
  if (isFirebaseConfigured() && database) {
    database.ref('settings/teacherPassword').on('value', (snapshot) => {
      const password = snapshot.val();
      if (password) {
        teacherPasswordCache = password;
        localStorage.setItem(TEACHER_PASSWORD_KEY, password);
      }
    });
  }
}

/**
 * パスワード変更モーダルを表示
 */
function showPasswordChangeModal() {
  document.getElementById('current-password').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('confirm-password').value = '';
  document.getElementById('password-change-modal').classList.remove('hidden');
}

/**
 * パスワード変更モーダルを閉じる
 */
function closePasswordChangeModal() {
  document.getElementById('password-change-modal').classList.add('hidden');
}

/**
 * 先生パスワードを変更
 */
async function changeTeacherPassword() {
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  
  if (currentPassword !== getTeacherPassword()) {
    showToast('現在のパスワードが違います', 'error');
    return;
  }
  
  if (!newPassword) {
    showToast('新しいパスワードを入力してください', 'error');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showToast('新しいパスワードが一致しません', 'error');
    return;
  }
  
  await setTeacherPassword(newPassword);
  closePasswordChangeModal();
  showToast('パスワードを変更しました');
}

// ============================================
// Session Management
// ============================================

/**
 * 生徒セッションを取得
 */
function getStudentSession() {
  try {
    const data = sessionStorage.getItem(STUDENT_SESSION_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

/**
 * 生徒セッションを保存
 */
function setStudentSession(session) {
  sessionStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(session));
}

/**
 * 生徒セッションを削除
 */
function clearStudentSession() {
  sessionStorage.removeItem(STUDENT_SESSION_KEY);
}

/**
 * 先生セッションを取得
 */
function getTeacherSession() {
  return sessionStorage.getItem(TEACHER_SESSION_KEY) === 'true';
}

/**
 * 先生セッションを保存
 */
function setTeacherSession(loggedIn) {
  if (loggedIn) {
    sessionStorage.setItem(TEACHER_SESSION_KEY, 'true');
  } else {
    sessionStorage.removeItem(TEACHER_SESSION_KEY);
  }
}

// ============================================
// Routing
// ============================================

/**
 * ページ遷移
 */
function navigateTo(page, params = {}) {
  let hash = page ? `#${page}` : '';
  
  if (params.id) {
    hash += `?id=${params.id}`;
  }
  
  window.location.hash = hash;
}

/**
 * ハッシュからページとパラメータを解析
 */
function parseHash() {
  const hash = window.location.hash.slice(1);
  const [page, queryString] = hash.split('?');
  const params = {};
  
  if (queryString) {
    queryString.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      params[key] = decodeURIComponent(value);
    });
  }
  
  return { page: page || '', params };
}

/**
 * ルーティング処理
 */
function handleRouting() {
  const { page, params } = parseHash();
  
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  
  switch (page) {
    case 'student-login':
      document.getElementById('page-student-login').classList.remove('hidden');
      initStudentLoginPage();
      break;
    case 'student-mypage':
      if (!getStudentSession()) {
        navigateTo('student-login');
        return;
      }
      document.getElementById('page-student-mypage').classList.remove('hidden');
      renderStudentMyPage();
      break;
    case 'student-detail':
      if (!getStudentSession()) {
        navigateTo('student-login');
        return;
      }
      document.getElementById('page-student-detail').classList.remove('hidden');
      renderStudentDetail(params.id);
      break;
    case 'student':
      if (!getStudentSession()) {
        navigateTo('student-login');
        return;
      }
      document.getElementById('page-student').classList.remove('hidden');
      initStudentPage();
      break;
    case 'teacher-login':
      document.getElementById('page-teacher-login').classList.remove('hidden');
      break;
    case 'teacher-settings':
      if (!getTeacherSession()) {
        navigateTo('teacher-login');
        return;
      }
      document.getElementById('page-teacher-settings').classList.remove('hidden');
      break;
    case 'teacher-students':
      if (!getTeacherSession()) {
        navigateTo('teacher-login');
        return;
      }
      document.getElementById('page-teacher-students').classList.remove('hidden');
      renderStudentList();
      break;
    case 'teacher':
      if (!getTeacherSession()) {
        navigateTo('teacher-login');
        return;
      }
      document.getElementById('page-teacher').classList.remove('hidden');
      renderTeacherList();
      break;
    case 'teacher-detail':
      if (!getTeacherSession()) {
        navigateTo('teacher-login');
        return;
      }
      document.getElementById('page-teacher-detail').classList.remove('hidden');
      renderTeacherDetail(params.id);
      break;
    default:
      document.getElementById('page-top').classList.remove('hidden');
      break;
  }
}

// ============================================
// Toast Notification
// ============================================

/**
 * トースト表示
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ============================================
// Date Formatting
// ============================================

/**
 * 日時フォーマット
 */
function formatDateTime(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

// ============================================
// Student Login
// ============================================

/**
 * 生徒ログインページ初期化
 */
function initStudentLoginPage() {
  const prefs = loadUserPrefs();
  const classSelect = document.getElementById('login-className');
  const initialsSelect = document.getElementById('login-initials');
  
  // クラス変更時にイニシャル一覧を更新
  classSelect.onchange = function() {
    updateInitialsSelect(this.value);
  };
  
  if (prefs.className) {
    classSelect.value = prefs.className;
    updateInitialsSelect(prefs.className, prefs.initials);
  } else {
    initialsSelect.innerHTML = '<option value="">先にクラスを選択</option>';
  }
  
  document.getElementById('login-birthday').value = '';
}

/**
 * イニシャル選択肢を更新
 */
function updateInitialsSelect(className, selectedInitials = '') {
  const initialsSelect = document.getElementById('login-initials');
  
  if (!className) {
    initialsSelect.innerHTML = '<option value="">先にクラスを選択</option>';
    return;
  }
  
  const students = loadStudents().filter(s => s.className === className);
  
  if (students.length === 0) {
    initialsSelect.innerHTML = '<option value="">該当する生徒がいません</option>';
    return;
  }
  
  // イニシャル順にソート
  students.sort((a, b) => a.initials.localeCompare(b.initials));
  
  initialsSelect.innerHTML = '<option value="">選択してください</option>' +
    students.map(s => `<option value="${escapeHtml(s.initials)}">${escapeHtml(s.initials)}</option>`).join('');
  
  if (selectedInitials) {
    initialsSelect.value = selectedInitials;
  }
}

/**
 * 生徒ログイン
 */
function studentLogin() {
  const className = document.getElementById('login-className').value;
  const initials = document.getElementById('login-initials').value;
  const birthday = document.getElementById('login-birthday').value.trim();
  
  if (!className) {
    showToast('クラスを選択してください', 'error');
    return;
  }
  
  if (!initials) {
    showToast('イニシャルを選択してください', 'error');
    return;
  }
  
  if (!birthday || !/^\d{4}$/.test(birthday)) {
    showToast('誕生日は4桁の数字で入力してください', 'error');
    return;
  }
  
  // 生徒を検索
  const student = findStudent(className, initials, birthday);
  
  if (!student) {
    showToast('パスワードが正しくありません', 'error');
    return;
  }
  
  // セッション保存
  setStudentSession({
    id: student.id,
    className: student.className,
    initials: student.initials
  });
  
  // プリファレンス保存
  saveUserPrefs({ className, initials });
  
  showToast('ログインしました');
  navigateTo('student-mypage');
}

/**
 * 生徒ログアウト
 */
function studentLogout() {
  clearStudentSession();
  navigateTo('');
}

// ============================================
// Student My Page
// ============================================

let studentTicketFilter = 'all';

/**
 * 生徒マイページを描画
 */
function renderStudentMyPage() {
  const session = getStudentSession();
  if (!session) return;
  
  // ユーザー情報表示
  document.getElementById('mypage-user-info').textContent = 
    `${session.className} / ${session.initials}`;
  
  // フィルタタブをリセット
  studentTicketFilter = 'all';
  document.querySelectorAll('#student-filter-tabs .filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === 'all');
  });
  
  renderStudentTicketList();
}

/**
 * 生徒の質問一覧フィルタ
 */
function filterStudentTickets(filter) {
  studentTicketFilter = filter;
  
  // タブのアクティブ状態を更新
  document.querySelectorAll('#student-filter-tabs .filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === filter);
  });
  
  renderStudentTicketList();
}

/**
 * 生徒の質問一覧を描画
 */
function renderStudentTicketList() {
  const session = getStudentSession();
  if (!session) return;
  
  // 自分のチケット一覧を取得
  let tickets = loadTickets().filter(t => t.studentId === session.id);
  
  // フィルタ適用
  if (studentTicketFilter !== 'all') {
    tickets = tickets.filter(t => t.status === studentTicketFilter);
  }
  
  // 新しい順にソート
  tickets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  const container = document.getElementById('student-ticket-list');
  
  if (tickets.length === 0) {
    const emptyMessage = studentTicketFilter === 'done' ? '解決済みの質問はありません' :
                         studentTicketFilter === 'submitted' ? '未解決の質問はありません' :
                         'まだ質問がありません';
    container.innerHTML = `
      <div class="empty-list">
        <div class="empty-list-icon">-</div>
        <p>${emptyMessage}</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = tickets.map(ticket => {
    const purposeClass = ticket.purpose === 'grading' ? 'badge-grading' : 'badge-question';
    const purposeIcon = ticket.purpose === 'grading' 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>';
    const purposeText = ticket.purpose === 'grading' ? '採点' : '質問';
    const statusClass = `badge-${ticket.status}`;
    const statusText = { submitted: '未解決', done: '解決済み' }[ticket.status] || ticket.status;
    const hasAnswer = ticket.status === 'done';
    const subjectClass = `subject-${ticket.subject}`;
    const questionImages = ticket.questionImages || [];
    const hasImages = questionImages.length > 0;
    
    return `
      <div class="ticket-card" onclick="navigateTo('student-detail', { id: '${ticket.id}' })">
        <div class="${hasImages ? 'ticket-card-with-image' : ''}">
          <div class="ticket-card-content">
            <div class="ticket-card-header">
              <span class="subject-badge ${subjectClass}">${escapeHtml(ticket.subject)}</span>
              <span class="purpose-badge ${purposeClass}">${purposeIcon}${purposeText}</span>
              <span class="ticket-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="ticket-meta">
              <span>${formatDateTime(ticket.createdAt)}</span>
            </div>
            <div class="ticket-reason">${escapeHtml(ticket.questionReason || (ticket.purpose === 'grading' ? '採点依頼' : ''))}</div>
          </div>
          ${hasImages ? `
          <div class="ticket-card-thumbnail">
            <img src="${questionImages[0]}" alt="問題画像">
            ${questionImages.length > 1 ? `<div class="thumbnail-more">+${questionImages.length - 1}</div>` : ''}
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// Student Detail
// ============================================

let currentStudentDetailTicketId = null;

/**
 * 生徒用質問詳細を描画
 */
function renderStudentDetail(id) {
  currentStudentDetailTicketId = id;
  const session = getStudentSession();
  if (!session) return;
  
  const ticket = getTicketById(id);
  
  if (!ticket || ticket.studentId !== session.id) {
    showToast('質問が見つかりません', 'error');
    navigateTo('student-mypage');
    return;
  }
  
  const purposeText = ticket.purpose === 'grading' ? '採点をお願いする' : '質問する';
  const purposeClass = ticket.purpose === 'grading' ? 'badge-grading' : 'badge-question';
  const purposeIcon = ticket.purpose === 'grading' 
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>';
  const statusText = { submitted: '未解決', done: '解決済み' }[ticket.status] || ticket.status;
  const isDone = ticket.status === 'done';
  const subjectClass = `subject-${ticket.subject}`;
  
  const content = document.getElementById('student-detail-content');
  content.innerHTML = `
    <!-- 基本情報 -->
    <div class="detail-section">
      <div class="detail-section-title">質問内容</div>
      <div class="detail-row">
        <span class="detail-label">教科</span>
        <span class="subject-badge ${subjectClass}">${escapeHtml(ticket.subject)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">目的</span>
        <span class="purpose-badge ${purposeClass}">${purposeIcon}${purposeText}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">ステータス</span>
        <span class="detail-value">${statusText}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">登録日時</span>
        <span class="detail-value">${formatDateTime(ticket.createdAt)}</span>
      </div>
    </div>
    
    ${ticket.purpose === 'question' ? `
    <!-- 質問内容 -->
    <div class="detail-highlight">
      <div class="detail-highlight-title">質問内容</div>
      <div class="detail-checks">
        ${(ticket.checkedMaterials || []).map(m => `<span class="detail-check-item">${escapeHtml(m)}</span>`).join('')}
      </div>
      <div class="detail-highlight-content">${escapeHtml(ticket.questionReason || '')}</div>
    </div>
    ` : ''}
    
    <!-- 問題画像 -->
    ${(ticket.questionImages || []).length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">問題画像（${ticket.questionImages.length}枚）</div>
        <div class="detail-gallery">
          ${ticket.questionImages.map(src => `
            <div class="detail-gallery-item">
              <img src="${src}" alt="問題画像" data-full="${src}" onclick="openDetailImageModal(this.dataset.full)">
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    
    <!-- 自分の答案画像 -->
    ${(ticket.myAnswerImages || []).length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">自分の答案（${ticket.myAnswerImages.length}枚）</div>
        <div class="detail-gallery">
          ${ticket.myAnswerImages.map(src => `
            <div class="detail-gallery-item">
              <img src="${src}" alt="自分の答案" data-full="${src}" onclick="openDetailImageModal(this.dataset.full)">
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    
    <!-- 解答画像 -->
    ${(ticket.answerImages || []).length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">解答・解説画像（${ticket.answerImages.length}枚）</div>
        <div class="detail-gallery">
          ${ticket.answerImages.map(src => `
            <div class="detail-gallery-item">
              <img src="${src}" alt="解答画像" data-full="${src}" onclick="openDetailImageModal(this.dataset.full)">
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    
    <!-- ステータス -->
    <div class="teacher-answer-card">
      <div class="teacher-answer-title">対応状況</div>
      ${ticket.status === 'done' ? `
        <div class="teacher-answer-content" style="color: var(--color-success);">対応完了</div>
      ` : `
        <div class="teacher-answer-empty">対応待ち</div>
      `}
    </div>
  `;
  
  // フッター
  const footer = document.getElementById('student-detail-footer');
  if (isDone) {
    footer.innerHTML = `
      <button class="btn btn-outline btn-block" onclick="navigateTo('student-mypage')">一覧へ戻る</button>
    `;
  } else {
    footer.innerHTML = `
      <button class="btn btn-outline" onclick="navigateTo('student-mypage')">戻る</button>
      <button class="btn btn-secondary" onclick="editTicket('${ticket.id}')">編集</button>
      <button class="btn btn-primary" onclick="showStudentCompleteModal()">解決した</button>
    `;
  }
}

/**
 * 生徒用完了確認モーダルを表示
 */
function showStudentCompleteModal() {
  if (confirm('この質問を完了しますか？\\n（先生からの回答を確認した場合に押してください）')) {
    completeStudentTicket();
  }
}

/**
 * 生徒が質問を完了する
 */
async function completeStudentTicket() {
  const ticket = getTicketById(currentStudentDetailTicketId);
  if (!ticket) return;
  
  ticket.status = 'done';
  ticket.doneAt = Date.now();
  ticket.completedByStudent = true;
  
  await upsertTicket(ticket);
  showToast('質問を完了しました');
  navigateTo('student-mypage');
}

// ============================================
// Student Page (Question Registration)
// ============================================

let questionImages = [];
let answerImages = [];
let myAnswerImages = [];
let currentEditingTicketId = null;

/**
 * 生徒画面初期化
 */
function initStudentPage() {
  const session = getStudentSession();
  if (!session) return;
  
  document.getElementById('student-form').reset();
  questionImages = [];
  answerImages = [];
  myAnswerImages = [];
  currentEditingTicketId = null;
  
  // タイトルをリセット
  document.getElementById('student-form-title').textContent = '質問登録';
  
  document.getElementById('preview-questionImages').innerHTML = '';
  document.getElementById('preview-answerImages').innerHTML = '';
  document.getElementById('preview-myAnswerImages').innerHTML = '';
  updateImageCount('question');
  updateImageCount('answer');
  updateImageCount('myAnswer');
  
  // ログイン情報を設定
  document.getElementById('input-studentId').value = session.id;
  document.getElementById('input-className').value = session.className;
  document.getElementById('input-initials').value = session.initials;
  document.getElementById('logged-in-info').innerHTML = 
    `<div class="logged-in-info-text">${escapeHtml(session.className)} / ${escapeHtml(session.initials)} でログイン中</div>`;
  
  document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector('[data-purpose="question"]').classList.add('active');
  document.getElementById('input-purpose').value = 'question';
  updateFormByPurpose('question');
  
  document.querySelectorAll('.form-error, .form-warning').forEach(el => el.classList.add('hidden'));
  
  setupStudentEventListeners();
}

/**
 * 既存のチケットを編集モードで開く
 */
function editTicket(ticketId) {
  const ticket = getTicketById(ticketId);
  if (!ticket) {
    showToast('質問が見つかりません', 'error');
    return;
  }
  
  // フォームページに移動（initStudentPageが呼ばれる）
  navigateTo('student');
  
  // フォームにデータを設定（少し遅延させてDOMの準備を待つ）
  setTimeout(() => {
    // 編集モードフラグを設定（initStudentPage後に設定）
    currentEditingTicketId = ticketId;
    
    // タイトルを編集モードに
    document.getElementById('student-form-title').textContent = '質問を編集';
    
    // 教科
    document.getElementById('input-subject').value = ticket.subject;
    
    // 目的
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-purpose="${ticket.purpose}"]`).classList.add('active');
    document.getElementById('input-purpose').value = ticket.purpose;
    updateFormByPurpose(ticket.purpose);
    
    // チェックボックス
    document.querySelectorAll('input[name="checkedMaterials"]').forEach(cb => {
      cb.checked = (ticket.checkedMaterials || []).includes(cb.value);
    });
    
    // 質問内容
    document.getElementById('input-questionReason').value = ticket.questionReason || '';
    
    // 画像を復元
    questionImages = [...(ticket.questionImages || [])];
    answerImages = [...(ticket.answerImages || [])];
    myAnswerImages = [...(ticket.myAnswerImages || [])];
    
    renderImagePreviews('question');
    renderImagePreviews('answer');
    renderImagePreviews('myAnswer');
    updateImageCount('question');
    updateImageCount('answer');
    updateImageCount('myAnswer');
  }, 100);
}

/**
 * 目的に応じてフォーム表示を切り替え
 */
function updateFormByPurpose(purpose) {
  const checkCard = document.getElementById('card-checkedMaterials');
  const reasonCard = document.getElementById('card-questionReason');
  const checkLabel = document.getElementById('label-checkedMaterials');
  const reasonLabel = document.getElementById('label-questionReason');
  const myAnswerSection = document.getElementById('myAnswerImages-section');
  
  if (purpose === 'grading') {
    // 採点の場合は任意
    checkLabel.classList.remove('required');
    reasonLabel.classList.remove('required');
    checkCard.style.display = 'none';
    reasonCard.style.display = 'none';
    if (myAnswerSection) myAnswerSection.classList.remove('hidden');
  } else {
    // 質問の場合は必須
    checkLabel.classList.add('required');
    reasonLabel.classList.add('required');
    checkCard.style.display = 'block';
    reasonCard.style.display = 'block';
    if (myAnswerSection) myAnswerSection.classList.add('hidden');
  }
}

/**
 * 生徒画面イベントリスナー設定
 */
function setupStudentEventListeners() {
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.onclick = function() {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('input-purpose').value = this.dataset.purpose;
      updateFormByPurpose(this.dataset.purpose);
    };
  });
  
  document.getElementById('input-questionImages').onchange = function(e) {
    handleImageUpload(e.target.files, 'question');
    this.value = '';
  };
  
  document.getElementById('input-answerImages').onchange = function(e) {
    handleImageUpload(e.target.files, 'answer');
    this.value = '';
  };
  
  document.getElementById('input-myAnswerImages').onchange = function(e) {
    handleImageUpload(e.target.files, 'myAnswer');
    this.value = '';
  };
  
  document.getElementById('input-questionReason').oninput = function() {
    const warning = document.getElementById('warning-questionReason');
    if (this.value.length > 0 && this.value.length < 20) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  };
}

/**
 * 画像アップロード処理（複数対応）
 */
function handleImageUpload(files, type) {
  const imageArray = type === 'question' ? questionImages : (type === 'answer' ? answerImages : myAnswerImages);
  
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const dataUrl = e.target.result;
      imageArray.push(dataUrl);
      renderImagePreviews(type);
      updateImageCount(type);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 画像枚数表示を更新
 */
function updateImageCount(type) {
  const images = type === 'question' ? questionImages : (type === 'answer' ? answerImages : myAnswerImages);
  const countEl = document.getElementById(`count-${type}Images`);
  
  if (!countEl) return;
  
  if (images.length > 0) {
    countEl.innerHTML = `<span class="image-count-badge">${images.length}枚選択中</span>`;
    countEl.classList.remove('hidden');
  } else {
    countEl.classList.add('hidden');
  }
}

/**
 * 画像プレビュー描画
 */
function renderImagePreviews(type) {
  const container = document.getElementById(`preview-${type}Images`);
  if (!container) return;
  
  const images = type === 'question' ? questionImages : (type === 'answer' ? answerImages : myAnswerImages);
  
  container.innerHTML = images.map((src, index) => `
    <div class="image-preview-item">
      <img src="${src}" alt="画像${index + 1}">
      <div class="image-preview-actions">
        <button type="button" class="image-action-btn" onclick="openImageModalByIndex('${type}', ${index})" title="拡大">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </button>
        <button type="button" class="image-action-btn" onclick="removeImage('${type}', ${index})" title="削除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * インデックスで画像拡大モーダルを開く
 */
function openImageModalByIndex(type, index) {
  const images = type === 'question' ? questionImages : answerImages;
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('image-modal-img');
  img.src = images[index];
  modal.classList.remove('hidden');
}

/**
 * 画像拡大モーダルを閉じる
 */
function closeImageModal() {
  document.getElementById('image-modal').classList.add('hidden');
}

/**
 * 詳細画面用の画像拡大
 */
function openDetailImageModal(src) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('image-modal-img');
  img.src = src;
  modal.classList.remove('hidden');
}

/**
 * 画像を削除
 */
function removeImage(type, index) {
  if (type === 'question') {
    questionImages.splice(index, 1);
  } else if (type === 'answer') {
    answerImages.splice(index, 1);
  }
  renderImagePreviews(type);
  updateImageCount(type);
}

/**
 * フォームバリデーション
 */
function validateForm() {
  const subject = document.getElementById('input-subject').value;
  if (!subject) {
    showToast('教科を選択してください', 'error');
    return false;
  }
  
  const purpose = document.getElementById('input-purpose').value;
  
  // 質問の場合のみチェックボックス必須
  if (purpose === 'question') {
    const checkedMaterials = Array.from(document.querySelectorAll('input[name="checkedMaterials"]:checked')).map(cb => cb.value);
    if (checkedMaterials.length === 0) {
      document.getElementById('error-checkedMaterials').classList.remove('hidden');
      showToast('事前に考えたことを1つ以上選択してください', 'error');
      return false;
    } else {
      document.getElementById('error-checkedMaterials').classList.add('hidden');
    }
    
    const questionReason = document.getElementById('input-questionReason').value.trim();
    if (!questionReason) {
      showToast('質問内容を入力してください', 'error');
      return false;
    }
  }
  
  return true;
}

/**
 * 3件制限チェック
 */
function checkTicketLimit(studentId) {
  const count = getActiveTicketCount(studentId, currentEditingTicketId);
  if (count >= MAX_TICKETS_PER_STUDENT) {
    showToast('現在、同時に質問できるのは3件までです。完了後に新しく登録できます。', 'error');
    return false;
  }
  return true;
}

/**
 * フォームデータを収集
 */
function collectFormData() {
  const session = getStudentSession();
  return {
    id: currentEditingTicketId || generateUUID(),
    studentId: session.id,
    className: session.className,
    initials: session.initials,
    subject: document.getElementById('input-subject').value,
    purpose: document.getElementById('input-purpose').value,
    checkedMaterials: Array.from(document.querySelectorAll('input[name="checkedMaterials"]:checked')).map(cb => cb.value),
    questionReason: document.getElementById('input-questionReason').value.trim(),
    questionImages: [...questionImages],
    answerImages: [...answerImages],
    myAnswerImages: [...myAnswerImages],
    teacherMemo: '',
    doneAt: null
  };
}


/**
 * 確認モーダルを表示
 */
function showConfirmModal() {
  if (!validateForm()) return;
  
  const session = getStudentSession();
  if (!checkTicketLimit(session.id)) return;
  
  const data = collectFormData();
  const purposeText = data.purpose === 'question' ? '質問する' : '採点をお願いする';
  
  const body = document.getElementById('confirm-modal-body');
  body.innerHTML = `
    <div class="confirm-section">
      <div class="confirm-label">クラス / イニシャル</div>
      <div class="confirm-value">${escapeHtml(data.className)} / ${escapeHtml(data.initials)}</div>
    </div>
    <div class="confirm-section">
      <div class="confirm-label">教科 / 目的</div>
      <div class="confirm-value">${escapeHtml(data.subject)} / ${purposeText}</div>
    </div>
    ${data.purpose === 'question' ? `
    <div class="confirm-section">
      <div class="confirm-label">事前に確認したこと</div>
      <div class="confirm-value">${data.checkedMaterials.map(m => escapeHtml(m)).join('、')}</div>
    </div>
    <div class="confirm-section">
      <div class="confirm-label">質問内容</div>
      <div class="confirm-value">${escapeHtml(data.questionReason)}</div>
    </div>
    ` : ''}
    ${data.questionImages.length > 0 ? `
      <div class="confirm-section">
        <div class="confirm-label">問題画像（${data.questionImages.length}枚）</div>
        <div class="confirm-images">
          ${data.questionImages.map(src => `<img src="${src}" alt="問題画像">`).join('')}
        </div>
      </div>
    ` : ''}
    ${data.myAnswerImages.length > 0 ? `
      <div class="confirm-section">
        <div class="confirm-label">自分の答案（${data.myAnswerImages.length}枚）</div>
        <div class="confirm-images">
          ${data.myAnswerImages.map(src => `<img src="${src}" alt="自分の答案">`).join('')}
        </div>
      </div>
    ` : ''}
    ${data.answerImages.length > 0 ? `
      <div class="confirm-section">
        <div class="confirm-label">解答画像（${data.answerImages.length}枚）</div>
        <div class="confirm-images">
          ${data.answerImages.map(src => `<img src="${src}" alt="解答画像">`).join('')}
        </div>
      </div>
    ` : ''}
  `;
  
  document.getElementById('confirm-modal').classList.remove('hidden');
}

/**
 * 確認モーダルを閉じる
 */
function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
}

/**
 * チケット送信
 */
async function submitTicket() {
  const formData = collectFormData();
  formData.status = 'submitted';
  
  await upsertTicket(formData);
  
  closeConfirmModal();
  showToast('送信しました');
  navigateTo('student-mypage');
}

// ============================================
// Teacher Login
// ============================================

/**
 * 先生ログイン
 */
function teacherLogin() {
  const password = document.getElementById('teacher-password').value;
  
  if (password === getTeacherPassword()) {
    setTeacherSession(true);
    showToast('ログインしました');
    navigateTo('teacher');
  } else {
    showToast('パスワードが違います', 'error');
  }
}

/**
 * 先生ログアウト
 */
function teacherLogout() {
  setTeacherSession(false);
  navigateTo('');
}

// ============================================
// Teacher - Student Management
// ============================================

let deleteStudentId = null;

/**
 * 生徒一覧を描画
 */
function renderStudentList() {
  const students = loadStudents();
  const classFilter = document.getElementById('filter-student-class').value;
  
  let filtered = students;
  if (classFilter) {
    filtered = students.filter(s => s.className === classFilter);
  }
  
  // クラス順、イニシャル順にソート
  const classOrder = ['4S', '5S', '6S', '1A', '2A', '3A', '4H', '5H', '6H', 'その他'];
  filtered.sort((a, b) => {
    const classA = classOrder.indexOf(a.className);
    const classB = classOrder.indexOf(b.className);
    if (classA !== classB) return classA - classB;
    return a.initials.localeCompare(b.initials);
  });
  
  const container = document.getElementById('student-manage-list');
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-list">
        <div class="empty-list-icon">-</div>
        <p>生徒が登録されていません</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filtered.map(student => `
    <div class="student-card">
      <div class="student-card-info">
        <div class="student-card-main">
          <span class="student-card-class">${escapeHtml(student.className)}</span>
          <span class="student-card-initials">${escapeHtml(student.initials)}</span>
        </div>
      </div>
      <div class="student-card-actions">
        <button class="student-action-btn" onclick="showEditStudentModal('${student.id}')" title="編集">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="student-action-btn delete" onclick="showDeleteStudentModal('${student.id}')" title="削除">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * 生徒追加モーダルを表示
 */
function showAddStudentModal() {
  document.getElementById('student-modal-title').textContent = '生徒を追加';
  document.getElementById('edit-student-id').value = '';
  document.getElementById('edit-student-class').value = '';
  document.getElementById('edit-student-initials').value = '';
  document.getElementById('edit-student-birthday').value = '';
  document.getElementById('student-modal').classList.remove('hidden');
}

/**
 * 生徒編集モーダルを表示
 */
function showEditStudentModal(studentId) {
  const student = getStudentById(studentId);
  if (!student) return;
  
  document.getElementById('student-modal-title').textContent = '生徒を編集';
  document.getElementById('edit-student-id').value = student.id;
  document.getElementById('edit-student-class').value = student.className;
  document.getElementById('edit-student-initials').value = student.initials;
  document.getElementById('edit-student-birthday').value = student.birthday;
  document.getElementById('student-modal').classList.remove('hidden');
}

/**
 * 生徒モーダルを閉じる
 */
function closeStudentModal() {
  document.getElementById('student-modal').classList.add('hidden');
}

/**
 * 生徒を保存
 */
async function saveStudent() {
  const id = document.getElementById('edit-student-id').value;
  const className = document.getElementById('edit-student-class').value;
  const initials = document.getElementById('edit-student-initials').value.trim().toUpperCase();
  const birthday = document.getElementById('edit-student-birthday').value.trim();
  
  if (!className) {
    showToast('クラスを選択してください', 'error');
    return;
  }
  
  if (!initials) {
    showToast('イニシャルを入力してください', 'error');
    return;
  }
  
  if (!birthday || !/^\d{4}$/.test(birthday)) {
    showToast('誕生日は4桁の数字で入力してください', 'error');
    return;
  }
  
  // 重複チェック（同じクラス・イニシャルの生徒がいないか）
  const students = loadStudents();
  const duplicate = students.find(s => 
    s.className === className && 
    s.initials.toUpperCase() === initials && 
    s.id !== id
  );
  
  if (duplicate) {
    showToast('同じクラス・イニシャルの生徒が既に登録されています', 'error');
    return;
  }
  
  const student = {
    id: id || generateUUID(),
    className,
    initials,
    birthday
  };
  
  await upsertStudent(student);
  closeStudentModal();
  showToast(id ? '更新しました' : '登録しました');
  renderStudentList();
}

/**
 * 削除確認モーダルを表示
 */
function showDeleteStudentModal(studentId) {
  deleteStudentId = studentId;
  const student = getStudentById(studentId);
  if (!student) return;
  
  document.getElementById('delete-modal-message').textContent = 
    `${student.className} / ${student.initials} を削除しますか？`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

/**
 * 削除モーダルを閉じる
 */
function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
  deleteStudentId = null;
}

/**
 * 生徒削除を実行
 */
async function confirmDeleteStudent() {
  if (!deleteStudentId) return;
  
  await deleteStudent(deleteStudentId);
  closeDeleteModal();
  showToast('削除しました');
  renderStudentList();
}

// ============================================
// Data Deletion
// ============================================

/**
 * データ削除モーダルを表示
 */
function showDeleteAllDataModal() {
  document.getElementById('delete-all-modal').classList.remove('hidden');
}

/**
 * データ削除モーダルを閉じる
 */
function closeDeleteAllDataModal() {
  document.getElementById('delete-all-modal').classList.add('hidden');
}

/**
 * 全ての質問データを削除
 */
async function deleteAllTickets() {
  if (confirm('全ての質問データを削除しますか？')) {
    if (isFirebaseConfigured() && database) {
      await database.ref('tickets').remove();
    }
    localStorage.removeItem(STORAGE_KEY);
    ticketsCache = [];
    closeDeleteAllDataModal();
    showToast('質問データを削除しました');
    navigateTo('teacher');
  }
}

/**
 * 全ての生徒データを削除
 */
async function deleteAllStudents() {
  if (confirm('全ての生徒データを削除しますか？')) {
    if (isFirebaseConfigured() && database) {
      await database.ref('students').remove();
    }
    localStorage.removeItem(STUDENTS_KEY);
    studentsCache = [];
    closeDeleteAllDataModal();
    showToast('生徒データを削除しました');
    navigateTo('teacher');
  }
}

/**
 * 全てのデータを削除
 */
async function deleteAllData() {
  if (confirm('全てのデータを削除しますか？この操作は取り消せません。')) {
    if (isFirebaseConfigured() && database) {
      await database.ref('tickets').remove();
      await database.ref('students').remove();
    }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STUDENTS_KEY);
    ticketsCache = [];
    studentsCache = [];
    closeDeleteAllDataModal();
    showToast('全てのデータを削除しました');
    navigateTo('teacher');
  }
}

// ============================================
// Teacher List Page
// ============================================

// 並び順: 'asc' = 古い順（デフォルト）, 'desc' = 新しい順
let teacherListSortOrder = 'asc';

/**
 * 並び順を切り替え
 */
function toggleSortOrder() {
  teacherListSortOrder = teacherListSortOrder === 'asc' ? 'desc' : 'asc';
  updateSortButton();
  renderTeacherList();
}

/**
 * 並び順ボタンの表示を更新
 */
function updateSortButton() {
  const btn = document.getElementById('sort-order-btn');
  if (btn) {
    if (teacherListSortOrder === 'asc') {
      btn.innerHTML = '<span class="sort-icon">↑</span> 古い順';
    } else {
      btn.innerHTML = '<span class="sort-icon">↓</span> 新しい順';
    }
  }
}

/**
 * クラスフィルタ変更時に生徒フィルタを更新
 */
function onTeacherClassFilterChange() {
  const classFilter = document.getElementById('filter-class').value;
  const studentSelect = document.getElementById('filter-student');
  
  // 生徒フィルタをリセット
  studentSelect.innerHTML = '<option value="">全生徒</option>';
  
  if (classFilter) {
    // 選択されたクラスの生徒を取得
    const students = loadStudents().filter(s => s.className === classFilter);
    students.sort((a, b) => a.initials.localeCompare(b.initials));
    
    students.forEach(student => {
      const option = document.createElement('option');
      option.value = student.initials;
      option.textContent = student.initials;
      studentSelect.appendChild(option);
    });
  }
  
  renderTeacherList();
}

/**
 * 先生一覧を描画
 */
function renderTeacherList() {
  const tickets = loadTickets();
  const classFilter = document.getElementById('filter-class').value;
  const studentFilter = document.getElementById('filter-student').value;
  const subjectFilter = document.getElementById('filter-subject').value;
  const statusFilter = document.getElementById('filter-status').value;
  
  let filtered = tickets.filter(t => {
    if (classFilter && t.className !== classFilter) return false;
    if (studentFilter && t.initials !== studentFilter) return false;
    if (subjectFilter && t.subject !== subjectFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });
  
  // 並び順: 古い順（asc）または新しい順（desc）
  filtered.sort((a, b) => {
    const statusOrder = { submitted: 0, draft: 1, done: 2 };
    const statusDiff = (statusOrder[a.status] || 2) - (statusOrder[b.status] || 2);
    if (statusDiff !== 0) return statusDiff;
    
    if (teacherListSortOrder === 'asc') {
      return (a.createdAt || 0) - (b.createdAt || 0); // 古い順
    } else {
      return (b.createdAt || 0) - (a.createdAt || 0); // 新しい順
    }
  });
  
  const container = document.getElementById('teacher-list');
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-list">
        <div class="empty-list-icon">-</div>
        <p>該当する質問がありません</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = filtered.map(ticket => {
    const purposeClass = ticket.purpose === 'grading' ? 'badge-grading' : 'badge-question';
    const purposeIcon = ticket.purpose === 'grading' 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>';
    const purposeText = ticket.purpose === 'grading' ? '採点' : '質問';
    const statusClass = `badge-${ticket.status}`;
    const statusText = { submitted: '対応待ち', done: '対応完了' }[ticket.status] || ticket.status;
    const questionImages = ticket.questionImages || [];
    const subjectClass = `subject-${ticket.subject}`;
    const hasImages = questionImages.length > 0;
    
    return `
      <div class="ticket-card" onclick="navigateTo('teacher-detail', { id: '${ticket.id}' })">
        <div class="${hasImages ? 'ticket-card-with-image' : ''}">
          <div class="ticket-card-content">
            <div class="ticket-card-header">
              <span class="subject-badge ${subjectClass}">${escapeHtml(ticket.subject)}</span>
              <span class="purpose-badge ${purposeClass}">${purposeIcon}${purposeText}</span>
              <span class="ticket-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="ticket-student">
              <span class="student-class">${escapeHtml(ticket.className)}</span>
              <span class="student-name">${escapeHtml(ticket.initials)}</span>
            </div>
            <div class="ticket-meta">
              <span>${formatDateTime(ticket.createdAt)}</span>
            </div>
            <div class="ticket-reason">${escapeHtml(ticket.questionReason || (ticket.purpose === 'grading' ? '採点依頼' : ''))}</div>
          </div>
          ${hasImages ? `
          <div class="ticket-card-thumbnail">
            <img src="${questionImages[0]}" alt="問題画像">
            ${questionImages.length > 1 ? `<div class="thumbnail-more">+${questionImages.length - 1}</div>` : ''}
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// Teacher Detail Page
// ============================================

let currentDetailTicketId = null;

/**
 * 先生詳細画面を描画
 */
function renderTeacherDetail(id) {
  currentDetailTicketId = id;
  const ticket = getTicketById(id);
  
  if (!ticket) {
    showToast('チケットが見つかりません', 'error');
    navigateTo('teacher');
    return;
  }
  
  const isDone = ticket.status === 'done';
  const purposeText = ticket.purpose === 'grading' ? '採点をお願いする' : '質問する';
  const purposeClass = ticket.purpose === 'grading' ? 'badge-grading' : 'badge-question';
  const purposeIcon = ticket.purpose === 'grading' 
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>';
  const studentDisplay = ticket.initials;
  const subjectClass = `subject-${ticket.subject}`;
  
  const content = document.getElementById('teacher-detail-content');
  content.innerHTML = `
    <div class="detail-wrapper">
      <!-- 基本情報 -->
      <div class="detail-row">
        <span class="detail-label">クラス</span>
        <span class="detail-value">${escapeHtml(ticket.className)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">生徒</span>
        <span class="detail-value">${escapeHtml(studentDisplay)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">教科</span>
        <span class="subject-badge ${subjectClass}">${escapeHtml(ticket.subject)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">目的</span>
        <span class="purpose-badge ${purposeClass}">${purposeIcon}${purposeText}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">受付日時</span>
        <span class="detail-value">${formatDateTime(ticket.createdAt)}</span>
      </div>
      ${isDone ? `
        <div class="detail-row">
          <span class="detail-label">完了日時</span>
          <span class="detail-value">${formatDateTime(ticket.doneAt)}</span>
        </div>
      ` : ''}
      
      ${ticket.purpose === 'question' ? `
        <!-- 確認事項 -->
        <div class="detail-divider"></div>
        <div class="detail-section-title">確認したこと</div>
        <div class="detail-checks">
          ${(ticket.checkedMaterials || []).map(m => `<span class="detail-check-item">${escapeHtml(m)}</span>`).join('')}
        </div>
        
        <!-- 質問内容 -->
        <div class="detail-section-title" style="margin-top: 16px;">質問内容</div>
        <div class="detail-highlight-content">${escapeHtml(ticket.questionReason || '')}</div>
      ` : ''}
      
      <!-- 問題画像 -->
      ${(ticket.questionImages || []).length > 0 ? `
        <div class="detail-divider"></div>
        <div class="detail-section-title">問題画像（${ticket.questionImages.length}枚）</div>
        <div class="detail-gallery">
          ${ticket.questionImages.map(src => `
            <div class="detail-gallery-item">
              <img src="${src}" alt="問題画像" data-full="${src}" onclick="openDetailImageModal(this.dataset.full)">
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <!-- 自分の答案画像 -->
      ${(ticket.myAnswerImages || []).length > 0 ? `
        <div class="detail-divider"></div>
        <div class="detail-section-title">自分の答案（${ticket.myAnswerImages.length}枚）</div>
        <div class="detail-gallery">
          ${ticket.myAnswerImages.map(src => `
            <div class="detail-gallery-item">
              <img src="${src}" alt="自分の答案" data-full="${src}" onclick="openDetailImageModal(this.dataset.full)">
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <!-- 解答画像 -->
      ${(ticket.answerImages || []).length > 0 ? `
        <div class="detail-divider"></div>
        <div class="detail-section-title">解答・解説画像（${ticket.answerImages.length}枚）</div>
        <div class="detail-gallery">
          ${ticket.answerImages.map(src => `
            <div class="detail-gallery-item">
              <img src="${src}" alt="解答画像" data-full="${src}" onclick="openDetailImageModal(this.dataset.full)">
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <!-- 先生メモ -->
      <div class="detail-divider"></div>
      <div class="detail-section-title">先生用メモ</div>
      <textarea id="input-teacherMemo" class="form-textarea" rows="3" 
        placeholder="先生用メモを入力" ${isDone ? 'readonly' : ''}>${escapeHtml(ticket.teacherMemo || '')}</textarea>
      ${!isDone ? `
      <button class="btn btn-memo-save" onclick="saveTeacherMemoWithToast()">先生用メモを保存</button>
      ` : ''}
    </div>
  `;
  
  // メモの自動保存（入力中に保存）
  if (!isDone) {
    const memoInput = document.getElementById('input-teacherMemo');
    if (memoInput) {
      let saveTimeout;
      memoInput.oninput = function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          saveTeacherMemo();
        }, 1000);
      };
    }
  }
  
  const footer = document.getElementById('teacher-detail-footer');
  if (isDone) {
    footer.innerHTML = `
      <button class="btn btn-outline" onclick="navigateTo('teacher')">一覧へ戻る</button>
    `;
  } else {
    footer.innerHTML = `
      <button class="btn btn-outline" onclick="navigateTo('teacher')">戻る</button>
      <button class="btn btn-primary" onclick="completeTicket()">対応完了</button>
    `;
  }
}

/**
 * 先生メモを保存（自動保存用）
 */
async function saveTeacherMemo() {
  const ticket = getTicketById(currentDetailTicketId);
  if (!ticket) return;
  
  const memoInput = document.getElementById('input-teacherMemo');
  if (memoInput) {
    ticket.teacherMemo = memoInput.value;
    await upsertTicket(ticket);
  }
}

/**
 * メモを保存（ボタン用・トースト付き）
 */
async function saveTeacherMemoWithToast() {
  await saveTeacherMemo();
  showToast('先生用メモを保存しました');
}

/**
 * チケットを完了（この質問への対応を完了）
 */
async function completeTicket() {
  const ticket = getTicketById(currentDetailTicketId);
  if (!ticket) return;
  
  const memoInput = document.getElementById('input-teacherMemo');
  if (memoInput) {
    ticket.teacherMemo = memoInput.value;
  }
  ticket.status = 'done';
  ticket.doneAt = Date.now();
  
  await upsertTicket(ticket);
  showToast('対応完了しました');
  navigateTo('teacher');
}

// ============================================
// Utility Functions
// ============================================

/**
 * HTML エスケープ
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// Initialization
// ============================================

window.addEventListener('hashchange', handleRouting);

document.addEventListener('DOMContentLoaded', () => {
  initializeFirebaseData();
  waitForData(() => {
    handleRouting();
  });
});
