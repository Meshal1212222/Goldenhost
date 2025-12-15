// Firebase Configuration for Sunday & Golden Host Platform
// =========================================================

const firebaseConfig = {
    apiKey: "AIzaSyACk3UhHouKfGsOu3ZJfaOhqLqucumn2UQ",
    authDomain: "sunday-fb28c.firebaseapp.com",
    databaseURL: "https://sunday-fb28c-default-rtdb.firebaseio.com",
    projectId: "sunday-fb28c",
    storageBucket: "sunday-fb28c.firebasestorage.app",
    messagingSenderId: "24752239756",
    appId: "1:24752239756:web:386c2c72624eb67ba337a9",
    measurementId: "G-R50TBPQFJL"
};

// Initialize Firebase
let app, database;

function initFirebase() {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            app = firebase.initializeApp(firebaseConfig);
        } else {
            app = firebase.apps[0];
        }
        database = firebase.database();
        console.log('✅ Firebase initialized successfully');
        return true;
    } else {
        console.error('❌ Firebase SDK not loaded');
        return false;
    }
}

// ==================== Database Operations ====================

// Generic save function
async function saveToFirebase(path, data) {
    try {
        await database.ref(path).set(data);
        console.log(`✅ Data saved to ${path}`);
        return true;
    } catch (error) {
        console.error(`❌ Error saving to ${path}:`, error);
        return false;
    }
}

// Generic load function
async function loadFromFirebase(path) {
    try {
        const snapshot = await database.ref(path).once('value');
        const data = snapshot.val();
        console.log(`✅ Data loaded from ${path}`);
        return data;
    } catch (error) {
        console.error(`❌ Error loading from ${path}:`, error);
        return null;
    }
}

// Push new item (auto-generate key)
async function pushToFirebase(path, data) {
    try {
        const newRef = await database.ref(path).push(data);
        console.log(`✅ Data pushed to ${path} with key: ${newRef.key}`);
        return newRef.key;
    } catch (error) {
        console.error(`❌ Error pushing to ${path}:`, error);
        return null;
    }
}

// Update specific fields
async function updateInFirebase(path, updates) {
    try {
        await database.ref(path).update(updates);
        console.log(`✅ Data updated at ${path}`);
        return true;
    } catch (error) {
        console.error(`❌ Error updating ${path}:`, error);
        return false;
    }
}

// Delete data
async function deleteFromFirebase(path) {
    try {
        await database.ref(path).remove();
        console.log(`✅ Data deleted from ${path}`);
        return true;
    } catch (error) {
        console.error(`❌ Error deleting from ${path}:`, error);
        return false;
    }
}

// Listen for realtime changes
function listenToFirebase(path, callback) {
    database.ref(path).on('value', (snapshot) => {
        const data = snapshot.val();
        callback(data);
    });
}

// Stop listening
function stopListening(path) {
    database.ref(path).off();
}

// ==================== Golden Host Specific Functions ====================

const GoldenHostDB = {
    // Paths
    paths: {
        reports: 'goldenhost/reports',
        refunds: 'goldenhost/refunds',
        conversations: 'goldenhost/conversations',
        sales: 'goldenhost/sales',
        library: 'goldenhost/library',
        activity: 'goldenhost/activity',
        users: 'goldenhost/users',
        sessions: 'goldenhost/sessions'
    },

    // Reports (البلاغات)
    async saveReports(reports) {
        return await saveToFirebase(this.paths.reports, reports);
    },
    async loadReports() {
        return await loadFromFirebase(this.paths.reports) || [];
    },
    async addReport(report) {
        return await pushToFirebase(this.paths.reports, report);
    },

    // Refunds (الاستردادات)
    async saveRefunds(refunds) {
        return await saveToFirebase(this.paths.refunds, refunds);
    },
    async loadRefunds() {
        return await loadFromFirebase(this.paths.refunds) || [];
    },
    async addRefund(refund) {
        return await pushToFirebase(this.paths.refunds, refund);
    },

    // Conversations (المحادثات)
    async saveConversations(conversations) {
        return await saveToFirebase(this.paths.conversations, conversations);
    },
    async loadConversations() {
        return await loadFromFirebase(this.paths.conversations) || [];
    },
    async addConversation(conversation) {
        return await pushToFirebase(this.paths.conversations, conversation);
    },

    // Sales (المبيعات)
    async saveSales(sales) {
        return await saveToFirebase(this.paths.sales, sales);
    },
    async loadSales() {
        return await loadFromFirebase(this.paths.sales) || [];
    },
    async addSale(sale) {
        return await pushToFirebase(this.paths.sales, sale);
    },

    // Library Data (الردود والإجراءات)
    async saveLibrary(libraryData) {
        return await saveToFirebase(this.paths.library, libraryData);
    },
    async loadLibrary() {
        return await loadFromFirebase(this.paths.library);
    },

    // Activity Log (سجل النشاطات)
    async saveActivity(activityLog) {
        return await saveToFirebase(this.paths.activity, activityLog);
    },
    async loadActivity() {
        return await loadFromFirebase(this.paths.activity) || [];
    },
    async addActivity(activity) {
        return await pushToFirebase(this.paths.activity, activity);
    },

    // Users (المستخدمين)
    async saveUsers(users) {
        return await saveToFirebase(this.paths.users, users);
    },
    async loadUsers() {
        return await loadFromFirebase(this.paths.users) || {};
    },

    // Realtime listeners
    listenToReports(callback) {
        listenToFirebase(this.paths.reports, callback);
    },
    listenToRefunds(callback) {
        listenToFirebase(this.paths.refunds, callback);
    },
    listenToConversations(callback) {
        listenToFirebase(this.paths.conversations, callback);
    },
    listenToSales(callback) {
        listenToFirebase(this.paths.sales, callback);
    }
};

// ==================== Sunday Board Specific Functions ====================

const SundayBoardDB = {
    // Paths
    paths: {
        boards: 'sunday/boards',
        tasks: 'sunday/tasks',
        groups: 'sunday/groups',
        settings: 'sunday/settings',
        users: 'sunday/users'
    },

    // Boards
    async saveBoard(boardId, boardData) {
        return await saveToFirebase(`${this.paths.boards}/${boardId}`, boardData);
    },
    async loadBoard(boardId) {
        return await loadFromFirebase(`${this.paths.boards}/${boardId}`);
    },
    async loadAllBoards() {
        return await loadFromFirebase(this.paths.boards) || {};
    },

    // Tasks
    async saveTasks(boardId, tasks) {
        return await saveToFirebase(`${this.paths.tasks}/${boardId}`, tasks);
    },
    async loadTasks(boardId) {
        return await loadFromFirebase(`${this.paths.tasks}/${boardId}`) || [];
    },
    async addTask(boardId, task) {
        return await pushToFirebase(`${this.paths.tasks}/${boardId}`, task);
    },
    async updateTask(boardId, taskId, updates) {
        return await updateInFirebase(`${this.paths.tasks}/${boardId}/${taskId}`, updates);
    },
    async deleteTask(boardId, taskId) {
        return await deleteFromFirebase(`${this.paths.tasks}/${boardId}/${taskId}`);
    },

    // Groups
    async saveGroups(boardId, groups) {
        return await saveToFirebase(`${this.paths.groups}/${boardId}`, groups);
    },
    async loadGroups(boardId) {
        return await loadFromFirebase(`${this.paths.groups}/${boardId}`) || [];
    },

    // Settings
    async saveSettings(settings) {
        return await saveToFirebase(this.paths.settings, settings);
    },
    async loadSettings() {
        return await loadFromFirebase(this.paths.settings) || {};
    },

    // Realtime listeners
    listenToBoard(boardId, callback) {
        listenToFirebase(`${this.paths.boards}/${boardId}`, callback);
    },
    listenToTasks(boardId, callback) {
        listenToFirebase(`${this.paths.tasks}/${boardId}`, callback);
    }
};

// ==================== Migration Helper ====================

// Migrate localStorage data to Firebase
async function migrateLocalStorageToFirebase() {
    console.log('🔄 Starting migration from localStorage to Firebase...');

    const migrations = [
        { key: 'customerReports', save: GoldenHostDB.saveReports.bind(GoldenHostDB) },
        { key: 'customerRefunds', save: GoldenHostDB.saveRefunds.bind(GoldenHostDB) },
        { key: 'customerConversations', save: GoldenHostDB.saveConversations.bind(GoldenHostDB) },
        { key: 'customerSales', save: GoldenHostDB.saveSales.bind(GoldenHostDB) },
        { key: 'libraryData', save: GoldenHostDB.saveLibrary.bind(GoldenHostDB) },
        { key: 'activityLog', save: GoldenHostDB.saveActivity.bind(GoldenHostDB) },
        { key: 'adminUsers', save: GoldenHostDB.saveUsers.bind(GoldenHostDB) }
    ];

    for (const { key, save } of migrations) {
        const data = localStorage.getItem(key);
        if (data) {
            try {
                const parsed = JSON.parse(data);
                await save(parsed);
                console.log(`✅ Migrated ${key}`);
            } catch (e) {
                console.error(`❌ Failed to migrate ${key}:`, e);
            }
        }
    }

    console.log('✅ Migration complete!');
}

// Export for use
window.firebaseConfig = firebaseConfig;
window.initFirebase = initFirebase;
window.GoldenHostDB = GoldenHostDB;
window.SundayBoardDB = SundayBoardDB;
window.migrateLocalStorageToFirebase = migrateLocalStorageToFirebase;
