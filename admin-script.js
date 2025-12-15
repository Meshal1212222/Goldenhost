// Check authentication
(function checkAuth() {
    const session = localStorage.getItem('adminSession');
    if (!session) {
        window.location.href = 'admin-login.html';
        return;
    }

    const data = JSON.parse(session);
    const loginTime = new Date(data.loginTime);
    const now = new Date();
    const hoursDiff = (now - loginTime) / (1000 * 60 * 60);

    if (hoursDiff >= 24) {
        localStorage.removeItem('adminSession');
        window.location.href = 'admin-login.html';
        return;
    }

    // Display user info
    document.getElementById('userName').textContent = data.name;
    const roleMap = {
        'admin': 'مدير النظام',
        'supervisor': 'مشرف',
        'reports': 'إدارة التقارير',
        'quality': 'مراقبة الجودة'
    };
    document.getElementById('userRole').textContent = roleMap[data.role] || data.role;
})();

// Initialize data from index.html (get default data)
let libraryData = {
    responses: [],
    procedures: [],
    teamRoles: [
        {
            name: 'يزيد (Yazeed)',
            role: 'مسؤول عن التقرير اليومي للمبيعات، إعداد تقارير الأداء، متابعة معدلات التحويل، تحليل البيانات اليومية'
        },
        {
            name: 'عبدالعزيز (Abdulaziz)',
            role: 'مراقبة ومتابعة التقارير من هنوف ويزيد، اتخاذ الإجراءات ورفعها للمدير المباشر للاعتماد، إرسال الإجراءات المعتمدة للموارد البشرية، مسؤول عن تقرير المكالمات اليومي'
        },
        {
            name: 'إبراهيم (Ibrahim)',
            role: 'دعم العملاء عبر المحادثة فقط - ممنوع منعاً باتاً الرد خارج النصوص المحددة في المكتبة'
        },
        {
            name: 'مصطفى (Mostafa)',
            role: 'دعم العملاء عبر المحادثة فقط - ممنوع منعاً باتاً الرد خارج النصوص المحددة في المكتبة'
        },
        {
            name: 'هنوف (Hanouf)',
            role: 'مراقبة وسماع جودة المكالمات حسب شروط الأداء، تقارير جودة المحادثات، مراقبة الأداء اليومي، فحص العقارات اليومي'
        }
    ]
};

// Initialize Firebase
let firebaseReady = false;

async function initFirebaseConnection() {
    if (typeof initFirebase === 'function') {
        firebaseReady = initFirebase();
        if (firebaseReady) {
            console.log('✅ Firebase connected in admin panel');
        }
    }
}

// Load saved data or use defaults
async function loadData() {
    // Try to load from Firebase first
    if (firebaseReady && typeof GoldenHostDB !== 'undefined') {
        try {
            const firebaseResponses = await GoldenHostDB.loadResponses();
            if (firebaseResponses && Object.keys(firebaseResponses).length > 0) {
                // Convert Firebase object to array
                libraryData.responses = Object.entries(firebaseResponses).map(([key, value]) => ({
                    ...value,
                    firebaseKey: key
                }));
                console.log('✅ Loaded responses from Firebase:', libraryData.responses.length);
            } else {
                // No data in Firebase, use defaults and save to Firebase
                libraryData.responses = getDefaultResponses();
                libraryData.procedures = getDefaultProcedures();
                await saveDataToFirebase();
            }
        } catch (error) {
            console.error('Error loading from Firebase:', error);
            loadFromLocalStorage();
        }
    } else {
        loadFromLocalStorage();
    }
    updateStats();
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('libraryData');
    if (saved) {
        libraryData = JSON.parse(saved);
        if (!libraryData.responses || libraryData.responses.length < 38) {
            libraryData.responses = getDefaultResponses();
            libraryData.procedures = getDefaultProcedures();
            saveData();
        }
    } else {
        libraryData.responses = getDefaultResponses();
        libraryData.procedures = getDefaultProcedures();
        saveData();
    }
}

async function saveData() {
    // Save to localStorage
    localStorage.setItem('libraryData', JSON.stringify(libraryData));
    // Also save to Firebase
    await saveDataToFirebase();
    updateStats();
}

async function saveDataToFirebase() {
    if (firebaseReady && typeof GoldenHostDB !== 'undefined') {
        try {
            // Convert array to object for Firebase
            const responsesObj = {};
            libraryData.responses.forEach((r, index) => {
                const key = r.firebaseKey || `response_${r.id || index}`;
                responsesObj[key] = { ...r };
                delete responsesObj[key].firebaseKey;
            });
            await GoldenHostDB.saveResponses(responsesObj);
            console.log('✅ Saved to Firebase');
        } catch (error) {
            console.error('Error saving to Firebase:', error);
        }
    }
}

function updateStats() {
    document.getElementById('totalResponses').textContent = libraryData.responses.length;
    document.getElementById('totalProcedures').textContent = libraryData.procedures.length;
}

// Log activity
function logActivity(action) {
    const session = JSON.parse(localStorage.getItem('adminSession'));
    const activityLog = JSON.parse(localStorage.getItem('activityLog') || '[]');
    activityLog.unshift({
        user: session.name,
        action: action,
        timestamp: new Date().toISOString()
    });
    // Keep only last 100 activities
    if (activityLog.length > 100) activityLog.length = 100;
    localStorage.setItem('activityLog', JSON.stringify(activityLog));
    loadRecentActivity();
}

// Navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    // Show selected section
    document.getElementById(sectionId).classList.add('active');

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    event.target.classList.add('active');

    // Load section data
    if (sectionId === 'responses') loadResponsesTable();
    if (sectionId === 'procedures') loadProceduresManagement();
    if (sectionId === 'reports') loadReports();
    if (sectionId === 'refunds') loadRefunds();
    if (sectionId === 'conversations') loadConversations();
    if (sectionId === 'sales') loadSales();
    if (sectionId === 'team') loadTeamManagement();
    if (sectionId === 'activity') loadActivityLog();
    if (sectionId === 'stats') loadStatistics();
}

// Dashboard
function loadRecentActivity() {
    const activityLog = JSON.parse(localStorage.getItem('activityLog') || '[]');
    const html = activityLog.slice(0, 5).map(activity => `
        <div class="activity-item">
            <div class="activity-user">${activity.user}</div>
            <div>${activity.action}</div>
            <div class="activity-time">${new Date(activity.timestamp).toLocaleString('ar-SA')}</div>
        </div>
    `).join('');
    document.getElementById('recentActivity').innerHTML = html || '<p>لا توجد نشاطات حديثة</p>';
}

// Responses Management
function loadResponsesTable() {
    const tbody = document.querySelector('#responsesTable tbody');
    tbody.innerHTML = libraryData.responses.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${r.title}</td>
            <td>${r.category}</td>
            <td>${r.priority || 'medium'}</td>
            <td>
                <button class="action-btn btn-edit" onclick="editResponse(${r.id})">✏️ تعديل</button>
                <button class="action-btn btn-delete" onclick="deleteResponse(${r.id})">🗑️ حذف</button>
            </td>
        </tr>
    `).join('');
}

function filterResponses() {
    const search = document.getElementById('searchResponses').value.toLowerCase();
    const tbody = document.querySelector('#responsesTable tbody');
    const filtered = libraryData.responses.filter(r =>
        r.title.toLowerCase().includes(search) ||
        r.problem.toLowerCase().includes(search) ||
        r.response.toLowerCase().includes(search)
    );
    tbody.innerHTML = filtered.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${r.title}</td>
            <td>${r.category}</td>
            <td>${r.priority || 'medium'}</td>
            <td>
                <button class="action-btn btn-edit" onclick="editResponse(${r.id})">✏️ تعديل</button>
                <button class="action-btn btn-delete" onclick="deleteResponse(${r.id})">🗑️ حذف</button>
            </td>
        </tr>
    `).join('');
}

function showAddResponseModal() {
    document.getElementById('responseModalTitle').textContent = 'إضافة رد جديد';
    document.getElementById('responseForm').reset();
    document.getElementById('responseId').value = '';
    document.getElementById('responseModal').classList.add('show');
}

function editResponse(id) {
    const response = libraryData.responses.find(r => r.id === id);
    if (!response) return;

    document.getElementById('responseModalTitle').textContent = 'تعديل الرد';
    document.getElementById('responseId').value = response.id;
    document.getElementById('responseTitle').value = response.title;
    document.getElementById('responseCategory').value = response.category;
    document.getElementById('responseProblem').value = response.problem;
    document.getElementById('responseText').value = response.response;
    document.getElementById('responsePriority').value = response.priority || 'medium';
    document.getElementById('responseTags').value = response.tags.join('، ');
    document.getElementById('responseNote').value = response.note || '';
    document.getElementById('responseModal').classList.add('show');
}

function closeResponseModal() {
    document.getElementById('responseModal').classList.remove('show');
}

function saveResponse(event) {
    event.preventDefault();

    const id = document.getElementById('responseId').value;
    const newResponse = {
        id: id ? parseInt(id) : Date.now(),
        category: document.getElementById('responseCategory').value,
        title: document.getElementById('responseTitle').value,
        problem: document.getElementById('responseProblem').value,
        response: document.getElementById('responseText').value,
        priority: document.getElementById('responsePriority').value,
        tags: document.getElementById('responseTags').value.split('،').map(t => t.trim()),
        note: document.getElementById('responseNote').value
    };

    if (id) {
        const index = libraryData.responses.findIndex(r => r.id === parseInt(id));
        libraryData.responses[index] = newResponse;
        logActivity(`تم تعديل الرد: ${newResponse.title}`);
    } else {
        libraryData.responses.push(newResponse);
        logActivity(`تم إضافة رد جديد: ${newResponse.title}`);
    }

    saveData();
    closeResponseModal();
    loadResponsesTable();
    alert('تم الحفظ بنجاح!');
}

function deleteResponse(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الرد؟')) return;

    const response = libraryData.responses.find(r => r.id === id);
    libraryData.responses = libraryData.responses.filter(r => r.id !== id);
    saveData();
    loadResponsesTable();
    logActivity(`تم حذف الرد: ${response.title}`);
    alert('تم الحذف بنجاح!');
}

// Procedures Management
function loadProceduresManagement() {
    const html = libraryData.procedures.map((proc, idx) => `
        <div style="margin-bottom: 1rem; padding: 1rem; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h3>${proc.title}</h3>
            <ul>
                ${proc.steps.map(step => `<li>${step}</li>`).join('')}
            </ul>
            <div style="margin-top: 1rem;">
                <button class="action-btn btn-edit" onclick="editProcedure(${idx})">✏️ تعديل</button>
                <button class="action-btn btn-delete" onclick="deleteProcedure(${idx})">🗑️ حذف</button>
            </div>
        </div>
    `).join('');
    document.getElementById('proceduresManagement').innerHTML = html || '<p>لا توجد إجراءات</p>';
}

function showAddProcedureModal() {
    const title = prompt('عنوان الإجراء:');
    if (!title) return;

    const steps = [];
    while (true) {
        const step = prompt('أضف خطوة (اضغط Cancel للإنهاء):');
        if (!step) break;
        steps.push(step);
    }

    if (steps.length === 0) {
        alert('يجب إضافة خطوة واحدة على الأقل!');
        return;
    }

    libraryData.procedures.push({ title, steps });
    saveData();
    loadProceduresManagement();
    logActivity(`تم إضافة إجراء جديد: ${title}`);
}

function deleteProcedure(index) {
    if (!confirm('هل أنت متأكد من حذف هذا الإجراء؟')) return;
    const proc = libraryData.procedures[index];
    libraryData.procedures.splice(index, 1);
    saveData();
    loadProceduresManagement();
    logActivity(`تم حذف الإجراء: ${proc.title}`);
}

// Team Management
function loadTeamManagement() {
    const html = libraryData.teamRoles.map((member, idx) => `
        <div style="margin-bottom: 1rem; padding: 1rem; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h3>${member.name}</h3>
            <p>${member.role}</p>
            <div style="margin-top: 1rem;">
                <button class="action-btn btn-edit" onclick="editTeamMember(${idx})">✏️ تعديل</button>
                <button class="action-btn btn-delete" onclick="deleteTeamMember(${idx})">🗑️ حذف</button>
            </div>
        </div>
    `).join('');
    document.getElementById('teamManagement').innerHTML = html;
}

function showAddTeamModal() {
    const name = prompt('اسم العضو:');
    if (!name) return;
    const role = prompt('الدور والمسؤوليات:');
    if (!role) return;

    libraryData.teamRoles.push({ name, role });
    saveData();
    loadTeamManagement();
    logActivity(`تم إضافة عضو جديد: ${name}`);
}

function deleteTeamMember(index) {
    if (!confirm('هل أنت متأكد من حذف هذا العضو؟')) return;
    const member = libraryData.teamRoles[index];
    libraryData.teamRoles.splice(index, 1);
    saveData();
    loadTeamManagement();
    logActivity(`تم حذف العضو: ${member.name}`);
}

// Activity Log
function loadActivityLog() {
    const activityLog = JSON.parse(localStorage.getItem('activityLog') || '[]');
    const html = activityLog.map(activity => `
        <div class="activity-item">
            <div class="activity-user">${activity.user}</div>
            <div>${activity.action}</div>
            <div class="activity-time">${new Date(activity.timestamp).toLocaleString('ar-SA')}</div>
        </div>
    `).join('');
    document.getElementById('activityLog').innerHTML = html || '<p>لا توجد نشاطات</p>';
}

function clearActivityLog() {
    if (!confirm('هل أنت متأكد من مسح سجل النشاطات؟')) return;
    localStorage.setItem('activityLog', '[]');
    loadActivityLog();
}

// Statistics
function loadStatistics() {
    // Get all data
    const reports = getDefaultReports();
    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const conversations = JSON.parse(localStorage.getItem('customerConversations') || '[]');
    const sales = JSON.parse(localStorage.getItem('customerSales') || '[]');

    // Update summary cards
    document.getElementById('totalReports').textContent = reports.length;
    document.getElementById('totalRefunds').textContent = refunds.length;
    document.getElementById('totalConversations').textContent = conversations.length;
    document.getElementById('totalSales').textContent = sales.length;

    // Create charts
    createReportsChart(reports);
    createSalesChart(sales);
    createRefundsChart(refunds);
    createConversationsChart(conversations);

    // Create employee performance table
    createEmployeePerformance(reports, refunds, conversations, sales);

    // Show top employees
    showTopEmployees(reports, sales);
}

function refreshAnalytics() {
    loadStatistics();
    alert('✅ تم تحديث البيانات!');
}

// Destroy existing chart if it exists
function destroyChart(chartId) {
    const existingChart = Chart.getChart(chartId);
    if (existingChart) {
        existingChart.destroy();
    }
}

function createReportsChart(reports) {
    const ctx = document.getElementById('reportsChart');
    if (!ctx) return;

    destroyChart('reportsChart');

    // Count reports by employee
    const employeeReports = {};
    reports.forEach(r => {
        const emp = r.employeeName || 'غير محدد';
        employeeReports[emp] = (employeeReports[emp] || 0) + 1;
    });

    const sortedEmployees = Object.entries(employeeReports)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedEmployees.map(e => e[0]),
            datasets: [{
                label: 'عدد البلاغات',
                data: sortedEmployees.map(e => e[1]),
                backgroundColor: 'rgba(255, 0, 0, 0.7)',
                borderColor: 'rgba(255, 0, 0, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

function createSalesChart(sales) {
    const ctx = document.getElementById('salesChart');
    if (!ctx) return;

    destroyChart('salesChart');

    // Count sales by action
    const actions = {};
    sales.forEach(s => {
        const action = s.action || 'غير محدد';
        actions[action] = (actions[action] || 0) + 1;
    });

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(actions),
            datasets: [{
                data: Object.values(actions),
                backgroundColor: [
                    'rgba(40, 167, 69, 0.8)',
                    'rgba(255, 193, 7, 0.8)',
                    'rgba(220, 53, 69, 0.8)',
                    'rgba(0, 123, 255, 0.8)',
                    'rgba(108, 117, 125, 0.8)',
                    'rgba(255, 99, 132, 0.8)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right'
                }
            }
        }
    });
}

function createRefundsChart(refunds) {
    const ctx = document.getElementById('refundsChart');
    if (!ctx) return;

    destroyChart('refundsChart');

    // Count refunds by status
    const statuses = {
        'pending': 0,
        'approved': 0,
        'completed': 0,
        'rejected': 0
    };

    refunds.forEach(r => {
        const status = r.status || 'pending';
        if (statuses.hasOwnProperty(status)) {
            statuses[status]++;
        }
    });

    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['قيد الانتظار', 'تمت الموافقة', 'مكتمل', 'مرفوض'],
            datasets: [{
                data: [statuses.pending, statuses.approved, statuses.completed, statuses.rejected],
                backgroundColor: [
                    'rgba(255, 193, 7, 0.8)',
                    'rgba(0, 123, 255, 0.8)',
                    'rgba(40, 167, 69, 0.8)',
                    'rgba(220, 53, 69, 0.8)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function createConversationsChart(conversations) {
    const ctx = document.getElementById('conversationsChart');
    if (!ctx) return;

    destroyChart('conversationsChart');

    // Count conversations by type
    const types = {};
    conversations.forEach(c => {
        const type = c.type || 'غير محدد';
        types[type] = (types[type] || 0) + 1;
    });

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(types),
            datasets: [{
                label: 'عدد المحادثات',
                data: Object.values(types),
                backgroundColor: 'rgba(75, 58, 140, 0.7)',
                borderColor: 'rgba(75, 58, 140, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            }
        }
    });
}

function createEmployeePerformance(reports, refunds, conversations, sales) {
    const container = document.getElementById('employeePerformance');
    if (!container) return;

    // Collect all unique employees
    const employees = new Set();
    reports.forEach(r => employees.add(r.employeeName || 'غير محدد'));
    refunds.forEach(r => employees.add(r.employeeName || 'غير محدد'));
    conversations.forEach(c => employees.add(c.employeeName || 'غير محدد'));
    sales.forEach(s => employees.add(s.employeeName || 'غير محدد'));

    const performance = Array.from(employees).map(emp => {
        return {
            name: emp,
            reports: reports.filter(r => r.employeeName === emp).length,
            refunds: refunds.filter(r => r.employeeName === emp).length,
            conversations: conversations.filter(c => c.employeeName === emp).length,
            sales: sales.filter(s => s.employeeName === emp).length,
            total: reports.filter(r => r.employeeName === emp).length +
                   refunds.filter(r => r.employeeName === emp).length +
                   conversations.filter(c => c.employeeName === emp).length +
                   sales.filter(s => s.employeeName === emp).length
        };
    }).sort((a, b) => b.total - a.total);

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>الموظف</th>
                    <th>🚨 البلاغات</th>
                    <th>💰 الاستردادات</th>
                    <th>💬 المحادثات</th>
                    <th>📈 المبيعات</th>
                    <th>📊 الإجمالي</th>
                </tr>
            </thead>
            <tbody>
    `;

    performance.forEach((emp, index) => {
        const rowStyle = index < 3 ? 'background: #fff3cd;' : '';
        html += `
            <tr style="${rowStyle}">
                <td><strong>${index < 3 ? '🏆 ' : ''}${emp.name}</strong></td>
                <td>${emp.reports}</td>
                <td>${emp.refunds}</td>
                <td>${emp.conversations}</td>
                <td>${emp.sales}</td>
                <td style="font-weight: 700; color: var(--primary-pink);">${emp.total}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function showTopEmployees(reports, sales) {
    const container = document.getElementById('topEmployees');
    if (!container) return;

    // Get top 3 by total activity
    const employees = new Set();
    reports.forEach(r => employees.add(r.employeeName || 'غير محدد'));
    sales.forEach(s => employees.add(s.employeeName || 'غير محدد'));

    const top = Array.from(employees).map(emp => ({
        name: emp,
        count: reports.filter(r => r.employeeName === emp).length +
               sales.filter(s => s.employeeName === emp).length
    })).sort((a, b) => b.count - a.count).slice(0, 3);

    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">';

    const medals = ['🥇', '🥈', '🥉'];
    const colors = [
        'linear-gradient(135deg, #FFD700, #FFA500)',
        'linear-gradient(135deg, #C0C0C0, #808080)',
        'linear-gradient(135deg, #CD7F32, #8B4513)'
    ];

    top.forEach((emp, index) => {
        html += `
            <div style="background: ${colors[index]}; color: white; padding: 1.5rem; border-radius: 15px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                <div style="font-size: 3rem;">${medals[index]}</div>
                <div style="font-size: 1.2rem; font-weight: 700; margin: 0.5rem 0;">${emp.name}</div>
                <div style="font-size: 2rem; font-weight: 700;">${emp.count}</div>
                <div style="font-size: 0.9rem; opacity: 0.9;">عملية</div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

// Export/Import
function exportAllData() {
    const data = {
        responses: libraryData.responses,
        procedures: libraryData.procedures,
        teamRoles: libraryData.teamRoles,
        exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `library-data-${Date.now()}.json`;
    a.click();
    logActivity('تم تصدير البيانات');
}

function exportResponses() {
    const blob = new Blob([JSON.stringify(libraryData.responses, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `responses-${Date.now()}.json`;
    a.click();
    logActivity('تم تصدير الردود');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm('هل تريد استبدال البيانات الحالية؟')) {
                libraryData = data;
                saveData();
                alert('تم استيراد البيانات بنجاح!');
                logActivity('تم استيراد بيانات جديدة');
                location.reload();
            }
        } catch (error) {
            alert('خطأ في قراءة الملف!');
        }
    };
    reader.readAsText(file);
}

function backupData() {
    exportAllData();
    alert('تم إنشاء نسخة احتياطية!');
}

function resetAllData() {
    if (!confirm('هل أنت متأكد من إعادة تعيين جميع البيانات؟ سيتم حذف كل شيء!')) return;
    if (!confirm('تحذير أخير! هذا الإجراء لا يمكن التراجع عنه!')) return;

    localStorage.removeItem('libraryData');
    libraryData.responses = getDefaultResponses();
    libraryData.procedures = getDefaultProcedures();
    saveData();
    alert('تم إعادة تعيين البيانات!');
    logActivity('تم إعادة تعيين جميع البيانات');
    location.reload();
}

// Settings
function changePassword(event) {
    event.preventDefault();
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (newPass !== confirm) {
        alert('كلمات المرور غير متطابقة!');
        return;
    }

    // Verify current password
    const session = JSON.parse(localStorage.getItem('adminSession'));
    const users = JSON.parse(localStorage.getItem('adminUsers') || '{}');
    const user = users[session.username];

    if (user && user.password !== current) {
        alert('كلمة المرور الحالية غير صحيحة!');
        return;
    }

    // Update password
    users[session.username] = { ...user, password: newPass };
    localStorage.setItem('adminUsers', JSON.stringify(users));
    alert('تم تغيير كلمة المرور بنجاح!');
    logActivity('تم تغيير كلمة المرور');
    event.target.reset();
}

// Logout
function logout() {
    if (!confirm('هل تريد تسجيل الخروج؟')) return;
    logActivity('تسجيل خروج');
    localStorage.removeItem('adminSession');
    window.location.href = 'admin-login.html';
}

// Default Data
function getDefaultResponses() {
    // Return all 38 responses from admin-data.js
    return ALL_RESPONSES;
}

function getDefaultProcedures() {
    // Return all 12 procedures from admin-data.js
    return ALL_PROCEDURES;
}

// ==================== REPORTS MANAGEMENT ====================

function getDefaultReports() {
    // دمج البيانات التاريخية مع البيانات الجديدة
    const historicalReports = typeof ALL_REPORTS !== 'undefined' ? ALL_REPORTS : [];
    const newReports = JSON.parse(localStorage.getItem('customerReports') || '[]');

    // دمج القائمتين (البيانات الجديدة أولاً)
    return [...newReports, ...historicalReports];
}

function loadReports(filter = 'all') {
    const reports = getDefaultReports();
    const container = document.getElementById('reportsManagement');

    // Update pending count
    const pendingCount = reports.filter(r => r.status === 'pending').length;
    document.getElementById('pendingReportsCount').textContent = pendingCount > 0 ? `${pendingCount} بلاغ جديد` : '';

    let filteredReports = reports;
    if (filter !== 'all') {
        filteredReports = reports.filter(r => r.status === filter);
    }

    if (filteredReports.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#666; padding:2rem;">لا توجد بلاغات</p>';
        return;
    }

    // Professional table view - Updated
    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table class="data-table" style="font-size: 0.9rem;">
                <thead>
                    <tr>
                        <th style="min-width: 100px;">رقم البلاغ</th>
                        <th style="min-width: 120px;">اسم الموظف</th>
                        <th style="min-width: 120px;">رقم الحجز</th>
                        <th style="min-width: 200px;">تفاصيل البلاغ</th>
                        <th style="min-width: 150px;">وقت رفع البلاغ</th>
                        <th style="min-width: 150px;">وقت استقبال البلاغ</th>
                        <th style="min-width: 150px;">وقت حل البلاغ</th>
                        <th style="min-width: 120px;">مستلم البلاغ</th>
                        <th style="min-width: 200px;">ملخص حل البلاغ</th>
                        <th style="min-width: 100px;">الحالة</th>
                        <th style="min-width: 120px;">المراجعة</th>
                        <th style="min-width: 180px;">الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredReports.map(report => {
                        const reportNum = report.id.replace('report_', '').substring(0, 8);
                        const timeSpent = calculateTimeSpent(report);

                        const details = report.reportDetails || report.message || '-';

                        return `
                        <tr>
                            <td><strong>#${reportNum}</strong></td>
                            <td>${report.employeeName || '-'}</td>
                            <td style="font-weight: 600;">${report.bookingNumber || '-'}</td>
                            <td>
                                <div style="max-width: 300px;">
                                    <span style="font-size:0.85rem; color:#333;">${details.substring(0, 100)}${details.length > 100 ? '...' : ''}</span>
                                    <br><button onclick="viewReportDetails('${report.id}')" style="font-size:0.75rem; margin-top:0.3rem; padding:0.2rem 0.5rem; border:1px solid #ddd; background:white; cursor:pointer; border-radius:4px;">عرض التفاصيل</button>
                                </div>
                            </td>
                            <td>${report.submitTime || report.date}</td>
                            <td>${report.receivedTime || '-'}</td>
                            <td>${report.resolvedTime || '-'}</td>
                            <td>${report.receivedBy || '-'}</td>
                            <td>
                                ${report.resolutionSummary ?
                                    `<div style="max-width:250px; font-size:0.85rem;">${report.resolutionSummary.substring(0, 100)}${report.resolutionSummary.length > 100 ? '...' : ''}</div>`
                                    : '-'}
                            </td>
                            <td>
                                <span class="status-badge status-${report.status}">
                                    ${report.status === 'pending' ? 'جديد' :
                                      report.status === 'in_progress' ? 'قيد المعالجة' : 'تم الحل'}
                                </span>
                                ${timeSpent ? `<br><small style="color:#666;">${timeSpent}</small>` : ''}
                            </td>
                            <td>
                                ${report.review ? `
                                    <div style="font-size:0.9rem;">
                                        <div style="color:#FFD700;">${'⭐'.repeat(report.review.rating)}</div>
                                        <small style="color:#666;">${report.review.comment || ''}</small>
                                    </div>
                                ` : '-'}
                            </td>
                            <td>
                                <div style="display:flex; flex-direction:column; gap:0.3rem;">
                                    ${report.status === 'pending' ? `
                                        <button class="btn btn-primary" style="padding:0.4rem 0.6rem; font-size:0.8rem;"
                                                onclick="acceptReport('${report.id}')">
                                            ✅ استلام
                                        </button>
                                    ` : ''}
                                    ${report.status === 'in_progress' ? `
                                        <button class="btn btn-success" style="padding:0.4rem 0.6rem; font-size:0.8rem;"
                                                onclick="showResolveModal('${report.id}')">
                                            ✓ حل البلاغ
                                        </button>
                                    ` : ''}
                                    <button class="btn btn-warning" style="padding:0.4rem 0.6rem; font-size:0.8rem;"
                                            onclick="deleteReport('${report.id}')">
                                        🗑️ حذف
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>

        <!-- Report Statistics -->
        <div style="margin-top:2rem; padding:1.5rem; background:#f8f9fa; border-radius:10px;">
            <h3 style="margin-bottom:1rem; color:var(--primary-purple);">📊 إحصائيات البلاغات</h3>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1rem;">
                <div style="background:white; padding:1rem; border-radius:8px;">
                    <div style="font-size:1.5rem; font-weight:700; color:#FFC107;">${reports.filter(r => r.status === 'pending').length}</div>
                    <div style="color:#666;">بلاغات جديدة</div>
                </div>
                <div style="background:white; padding:1rem; border-radius:8px;">
                    <div style="font-size:1.5rem; font-weight:700; color:#2196F3;">${reports.filter(r => r.status === 'in_progress').length}</div>
                    <div style="color:#666;">قيد المعالجة</div>
                </div>
                <div style="background:white; padding:1rem; border-radius:8px;">
                    <div style="font-size:1.5rem; font-weight:700; color:#4CAF50;">${reports.filter(r => r.status === 'resolved').length}</div>
                    <div style="color:#666;">تم الحل</div>
                </div>
                <div style="background:white; padding:1rem; border-radius:8px;">
                    <div style="font-size:1.5rem; font-weight:700; color:var(--primary-purple);">${calculateAverageTime(reports)}</div>
                    <div style="color:#666;">متوسط وقت الحل</div>
                </div>
            </div>
        </div>
    `;
}

function calculateTimeSpent(report) {
    if (!report.submitTime) return null;

    const start = new Date(report.submitTime);
    const end = report.resolvedTime ? new Date(report.resolvedTime) : new Date();
    const diff = end - start;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days} يوم`;
    } else if (hours > 0) {
        return `${hours} ساعة`;
    } else {
        return `${minutes} دقيقة`;
    }
}

function calculateAverageTime(reports) {
    const resolved = reports.filter(r => r.status === 'resolved' && r.submitTime && r.resolvedTime);
    if (resolved.length === 0) return '-';

    const totalMinutes = resolved.reduce((sum, r) => {
        const start = new Date(r.submitTime);
        const end = new Date(r.resolvedTime);
        return sum + (end - start) / (1000 * 60);
    }, 0);

    const avgMinutes = Math.floor(totalMinutes / resolved.length);
    if (avgMinutes > 60) {
        const hours = Math.floor(avgMinutes / 60);
        return `${hours} ساعة`;
    }
    return `${avgMinutes} دقيقة`;
}

function viewReportDetails(reportId) {
    const reports = getDefaultReports();
    const report = reports.find(r => r.id === reportId);

    if (!report) return;

    const details = `
📋 تفاصيل البلاغ الكاملة
━━━━━━━━━━━━━━━━━━━━━━
الموظف: ${report.employeeName}
${report.category ? 'نوع البلاغ: ' + report.category : ''}
${report.subject ? 'الموضوع: ' + report.subject : ''}
${report.bookingNumber ? 'رقم الحجز: ' + report.bookingNumber : ''}

التفاصيل:
${report.message || report.reportDetails || '-'}

${report.customerInfo ? `معلومات العميل:\n${report.customerInfo}\n` : ''}
${report.resolutionSummary ? `\nالحل:\n${report.resolutionSummary}` : ''}
${report.operationDate ? `\nتاريخ العملية: ${report.operationDate}` : ''}
${report.review ? `\nالمراجعة: ${report.review}` : ''}
    `;

    alert(details);
}

function acceptReport(reportId) {
    const session = JSON.parse(localStorage.getItem('adminSession'));
    const reports = JSON.parse(localStorage.getItem('customerReports') || '[]');
    const report = reports.find(r => r.id === reportId);

    if (report) {
        report.status = 'in_progress';
        report.receivedTime = new Date().toLocaleString('ar-SA');
        report.receivedBy = session.name;
        localStorage.setItem('customerReports', JSON.stringify(reports));

        logActivity(`استلام البلاغ: "${report.subject}" من ${report.employeeName}`);
        loadReports();
    }
}

function showResolveModal(reportId) {
    const summary = prompt('أدخل ملخص حل البلاغ (مفصل):');

    if (summary && summary.trim()) {
        const reports = JSON.parse(localStorage.getItem('customerReports') || '[]');
        const report = reports.find(r => r.id === reportId);

        if (report) {
            report.resolutionSummary = summary.trim();
            report.status = 'resolved';
            report.resolvedTime = new Date().toLocaleString('ar-SA');
            localStorage.setItem('customerReports', JSON.stringify(reports));

            logActivity(`تم حل البلاغ: "${report.subject}"`);
            loadReports();
            alert('✅ تم حل البلاغ بنجاح! يمكن للموظف الآن مراجعة الحل.');
        }
    }
}

function filterReportsByStatus(status) {
    // Update active tab
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    loadReports(status);
}

function updateReportStatus(reportId, newStatus) {
    const reports = JSON.parse(localStorage.getItem('customerReports') || '[]');
    const report = reports.find(r => r.id === reportId);

    if (report) {
        report.status = newStatus;
        localStorage.setItem('customerReports', JSON.stringify(reports));

        const statusText = newStatus === 'in_progress' ? 'قيد المعالجة' :
                          newStatus === 'resolved' ? 'تم الحل' : 'جديد';
        logActivity(`تغيير حالة البلاغ "${report.subject}" إلى: ${statusText}`);

        loadReports();
    }
}

function showReportResponseModal(reportId) {
    const response = prompt('أدخل الرد على البلاغ:');

    if (response && response.trim()) {
        const reports = JSON.parse(localStorage.getItem('customerReports') || '[]');
        const report = reports.find(r => r.id === reportId);

        if (report) {
            report.response = response.trim();
            report.status = 'resolved';
            report.resolvedDate = new Date().toLocaleString('ar-SA');
            localStorage.setItem('customerReports', JSON.stringify(reports));

            logActivity(`تم حل البلاغ: "${report.subject}"`);
            loadReports();
            alert('✅ تم حل البلاغ وإرسال الرد');
        }
    }
}

function deleteReport(reportId) {
    if (confirm('هل أنت متأكد من حذف هذا البلاغ؟')) {
        let reports = JSON.parse(localStorage.getItem('customerReports') || '[]');
        reports = reports.filter(r => r.id !== reportId);
        localStorage.setItem('customerReports', JSON.stringify(reports));

        logActivity('حذف بلاغ');
        loadReports();
    }
}

// ==================== REFUNDS MANAGEMENT ====================

function loadRefunds(filter = 'all') {
    // دمج البيانات التاريخية مع البيانات الجديدة
    const historicalRefunds = typeof ALL_REFUNDS !== 'undefined' ? ALL_REFUNDS : [];
    const newRefunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const refunds = [...newRefunds, ...historicalRefunds];

    const container = document.getElementById('refundsManagement');

    let filteredRefunds = refunds;
    if (filter !== 'all') {
        filteredRefunds = refunds.filter(r => r.status === filter);
    }

    if (filteredRefunds.length === 0) {
        container.innerHTML = '<div class="no-data">📭 لا توجد طلبات استرداد</div>';
        return;
    }

    let html = `
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>رقم الطلب</th>
                        <th>الموظف</th>
                        <th>رقم الحجز</th>
                        <th>العميل</th>
                        <th>المبلغ</th>
                        <th>السبب</th>
                        <th>التفاصيل</th>
                        <th>وقت الطلب</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
    `;

    filteredRefunds.forEach(refund => {
        const statusBadge = refund.status === 'pending' ? 'status-pending' :
                          refund.status === 'approved' ? 'status-in_progress' :
                          'status-resolved';
        const statusText = refund.status === 'pending' ? 'قيد الانتظار' :
                         refund.status === 'approved' ? 'تمت الموافقة' :
                         'مكتمل';

        html += `
            <tr>
                <td style="font-weight: 600;">#${refund.id.slice(-6)}</td>
                <td>${refund.employeeName}</td>
                <td>${refund.bookingNumber}</td>
                <td>${refund.customerName}</td>
                <td style="font-weight: 700; color: var(--primary-pink);">${refund.amount} ر.س</td>
                <td>${refund.reason}</td>
                <td>${refund.details.substring(0, 50)}${refund.details.length > 50 ? '...' : ''}</td>
                <td style="font-size: 0.85rem; color: #666;">${refund.submitTime}</td>
                <td><span class="status-badge ${statusBadge}">${statusText}</span></td>
                <td>
                    <button class="btn-action btn-view" onclick="viewRefundDetails('${refund.id}')" title="عرض">👁️</button>
                    ${refund.status === 'pending' ? `
                        <button class="btn-action btn-success" onclick="approveRefund('${refund.id}')" title="موافقة">✅</button>
                        <button class="btn-action btn-danger" onclick="rejectRefund('${refund.id}')" title="رفض">❌</button>
                    ` : ''}
                    ${refund.status === 'approved' ? `
                        <button class="btn-action btn-success" onclick="completeRefund('${refund.id}')" title="اكتمل">✅</button>
                    ` : ''}
                    <button class="btn-action btn-danger" onclick="deleteRefund('${refund.id}')" title="حذف">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function filterRefunds(status) {
    // Update active tab
    const tabs = document.querySelectorAll('#refunds .tab-btn');
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    loadRefunds(status);
}

function approveRefund(refundId) {
    const supervisorName = prompt('اسم المشرف الموافق على الطلب:');
    if (!supervisorName) return;

    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const refundIndex = refunds.findIndex(r => r.id === refundId);

    if (refundIndex !== -1) {
        refunds[refundIndex].status = 'approved';
        refunds[refundIndex].approvedTime = new Date().toLocaleString('ar-SA');
        refunds[refundIndex].approvedBy = supervisorName;

        localStorage.setItem('customerRefunds', JSON.stringify(refunds));
        alert('✅ تمت الموافقة على الطلب');
        loadRefunds();
    }
}

function rejectRefund(refundId) {
    const reason = prompt('سبب رفض الطلب:');
    if (!reason) return;

    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const refundIndex = refunds.findIndex(r => r.id === refundId);

    if (refundIndex !== -1) {
        refunds[refundIndex].status = 'rejected';
        refunds[refundIndex].notes = reason;

        localStorage.setItem('customerRefunds', JSON.stringify(refunds));
        alert('❌ تم رفض الطلب');
        loadRefunds();
    }
}

function completeRefund(refundId) {
    if (!confirm('هل تم تحويل المبلغ للعميل؟')) return;

    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const refundIndex = refunds.findIndex(r => r.id === refundId);

    if (refundIndex !== -1) {
        refunds[refundIndex].status = 'completed';
        refunds[refundIndex].processedTime = new Date().toLocaleString('ar-SA');

        localStorage.setItem('customerRefunds', JSON.stringify(refunds));
        alert('✅ تم تحديث الحالة إلى مكتمل');
        loadRefunds();
    }
}

function deleteRefund(refundId) {
    if (!confirm('هل أنت متأكد من حذف هذا الطلب؟')) return;

    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const filteredRefunds = refunds.filter(r => r.id !== refundId);

    localStorage.setItem('customerRefunds', JSON.stringify(filteredRefunds));
    alert('✅ تم حذف الطلب');
    loadRefunds();
}

function viewRefundDetails(refundId) {
    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    const refund = refunds.find(r => r.id === refundId);

    if (!refund) return;

    const details = `
💰 تفاصيل طلب الاسترداد
━━━━━━━━━━━━━━━━━━━━━━
الموظف: ${refund.employeeName}
رقم الحجز: ${refund.bookingNumber}
اسم العميل: ${refund.customerName}
المبلغ: ${refund.amount} ر.س

السبب: ${refund.reason}

التفاصيل:
${refund.details}

وقت الطلب: ${refund.submitTime}
${refund.approvedTime ? 'وقت الموافقة: ' + refund.approvedTime : ''}
${refund.approvedBy ? 'الموافق: ' + refund.approvedBy : ''}
${refund.processedTime ? 'وقت المعالجة: ' + refund.processedTime : ''}
${refund.notes ? 'ملاحظات: ' + refund.notes : ''}

الحالة: ${refund.status === 'pending' ? 'قيد الانتظار' :
          refund.status === 'approved' ? 'تمت الموافقة' :
          refund.status === 'completed' ? 'مكتمل' : 'مرفوض'}
    `;

    alert(details);
}

function exportRefunds() {
    const refunds = JSON.parse(localStorage.getItem('customerRefunds') || '[]');
    if (refunds.length === 0) {
        alert('لا توجد بيانات للتصدير');
        return;
    }

    const csvContent = 'data:text/csv;charset=utf-8,'
        + 'رقم الطلب,الموظف,رقم الحجز,العميل,المبلغ,السبب,التفاصيل,وقت الطلب,الحالة\n'
        + refunds.map(r =>
            `${r.id},${r.employeeName},${r.bookingNumber},${r.customerName},${r.amount},${r.reason},"${r.details}",${r.submitTime},${r.status}`
        ).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `refunds_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==================== CONVERSATIONS MANAGEMENT ====================

function loadConversations(filter = 'all') {
    // دمج البيانات التاريخية مع البيانات الجديدة
    const historicalConversations = typeof ALL_CONVERSATIONS !== 'undefined' ? ALL_CONVERSATIONS : [];
    const newConversations = JSON.parse(localStorage.getItem('customerConversations') || '[]');
    const conversations = [...newConversations, ...historicalConversations];

    const container = document.getElementById('conversationsManagement');

    let filteredConversations = conversations;
    if (filter !== 'all') {
        if (filter === 'warning') {
            filteredConversations = conversations.filter(c => c.requiredAction !== 'لا يوجد' && c.status === 'pending');
        } else if (filter === 'resolved') {
            filteredConversations = conversations.filter(c => c.status === 'completed');
        }
    }

    if (filteredConversations.length === 0) {
        container.innerHTML = '<div class="no-data">📭 لا توجد محادثات مسجلة</div>';
        return;
    }

    let html = `
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>رقم المتابعة</th>
                        <th>يوزر الموظف</th>
                        <th>رقم الضيف</th>
                        <th>رقم المضيف</th>
                        <th>الموضوع</th>
                        <th>الملخص</th>
                        <th>الإجراء المتخذ</th>
                        <th>وقت التسجيل</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
    `;

    filteredConversations.forEach(conv => {
        const statusBadge = conv.status === 'pending' ? 'status-pending' : 'status-resolved';
        const statusText = conv.status === 'pending' ? 'قيد المراجعة' : 'مكتمل';

        // تحديد لون الإجراء
        const actionColor = conv.requiredAction === 'إنذار بتعليق العقار' ? 'background: #FF9800; color: white;' :
                          conv.requiredAction === 'تعليق العقار' ? 'background: #DC3545; color: white;' :
                          conv.requiredAction === 'تنويه للمضيف' ? 'background: #FFC107; color: #333;' :
                          'background: #28A745; color: white;';

        html += `
            <tr>
                <td style="font-weight: 600;">#${conv.id.slice(-6)}</td>
                <td>${conv.employeeUser || conv.employeeName || '-'}</td>
                <td style="direction: ltr;">${conv.guestPhone || conv.customerPhone || '-'}</td>
                <td style="direction: ltr;">${conv.hostPhone || '-'}</td>
                <td>${conv.subject || '-'}</td>
                <td>${conv.summary ? conv.summary.substring(0, 60) + (conv.summary.length > 60 ? '...' : '') : '-'}</td>
                <td><span style="padding: 0.3rem 0.8rem; border-radius: 15px; font-size: 0.8rem; ${actionColor}">${conv.requiredAction || '-'}</span></td>
                <td style="font-size: 0.85rem; color: #666;">${conv.recordTime || '-'}</td>
                <td><span class="status-badge ${statusBadge}">${statusText}</span></td>
                <td>
                    <button class="btn-action btn-view" onclick="viewConversationDetails('${conv.id}')" title="عرض">👁️</button>
                    ${conv.status === 'pending' ? `
                        <button class="btn-action btn-success" onclick="completeConversation('${conv.id}')" title="اكتمل">✅</button>
                    ` : ''}
                    <button class="btn-action btn-danger" onclick="deleteConversation('${conv.id}')" title="حذف">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function filterConversations(status) {
    // Update active tab
    const tabs = document.querySelectorAll('#conversations .tab-btn');
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    loadConversations(status);
}

function completeConversation(convId) {
    const action = prompt('ما الإجراء الذي تم اتخاذه؟');
    if (!action) return;

    const supervisorName = prompt('اسم المراجع:');
    if (!supervisorName) return;

    const conversations = JSON.parse(localStorage.getItem('customerConversations') || '[]');
    const convIndex = conversations.findIndex(c => c.id === convId);

    if (convIndex !== -1) {
        conversations[convIndex].status = 'completed';
        conversations[convIndex].reviewTime = new Date().toLocaleString('ar-SA');
        conversations[convIndex].reviewedBy = supervisorName;
        conversations[convIndex].actionTaken = action;

        localStorage.setItem('customerConversations', JSON.stringify(conversations));
        alert('✅ تم تحديث الحالة إلى مكتمل');
        loadConversations();
    }
}

function deleteConversation(convId) {
    if (!confirm('هل أنت متأكد من حذف هذه المتابعة؟')) return;

    const conversations = JSON.parse(localStorage.getItem('customerConversations') || '[]');
    const filteredConversations = conversations.filter(c => c.id !== convId);

    localStorage.setItem('customerConversations', JSON.stringify(filteredConversations));
    alert('✅ تم حذف المتابعة');
    loadConversations();
}

function viewConversationDetails(convId) {
    const conversations = JSON.parse(localStorage.getItem('customerConversations') || '[]');
    const conv = conversations.find(c => c.id === convId);

    if (!conv) return;

    const details = `
💬 تفاصيل متابعة المحادثة
━━━━━━━━━━━━━━━━━━━━━━
الموظف: ${conv.employeeName}
رقم العميل: ${conv.customerPhone}
النوع: ${conv.type}
الموضوع: ${conv.subject}

ملخص المحادثة:
${conv.summary}

الإجراء المطلوب: ${conv.requiredAction}
وقت التسجيل: ${conv.recordTime}
${conv.reviewTime ? 'وقت المراجعة: ' + conv.reviewTime : ''}
${conv.reviewedBy ? 'المراجع: ' + conv.reviewedBy : ''}
${conv.actionTaken ? 'الإجراء المتخذ: ' + conv.actionTaken : ''}

الحالة: ${conv.status === 'pending' ? 'قيد المراجعة' : 'مكتمل'}
    `;

    alert(details);
}

function exportConversations() {
    const conversations = JSON.parse(localStorage.getItem('customerConversations') || '[]');
    if (conversations.length === 0) {
        alert('لا توجد بيانات للتصدير');
        return;
    }

    const csvContent = 'data:text/csv;charset=utf-8,'
        + 'رقم المتابعة,الموظف,رقم العميل,النوع,الموضوع,الملخص,الإجراء المطلوب,وقت التسجيل,الحالة\n'
        + conversations.map(c =>
            `${c.id},${c.employeeName},${c.customerPhone},${c.type},${c.subject},"${c.summary}",${c.requiredAction},${c.recordTime},${c.status}`
        ).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `conversations_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==================== SALES MANAGEMENT ====================

function loadSales(filter = 'all') {
    // دمج البيانات التاريخية مع البيانات الجديدة
    const historicalSales = typeof ALL_SALES !== 'undefined' ? ALL_SALES : [];
    const newSales = JSON.parse(localStorage.getItem('customerSales') || '[]');
    const sales = [...newSales, ...historicalSales];

    const container = document.getElementById('salesManagement');

    if (!container) return;

    let filteredSales = sales;
    if (filter !== 'all') {
        filteredSales = sales.filter(s => s.action === filter || s.status === filter);
    }

    if (filteredSales.length === 0) {
        container.innerHTML = '<div class="no-data">📭 لا توجد عمليات مبيعات مسجلة</div>';
        return;
    }

    let html = `
        <div style="margin-bottom: 1rem;">
            <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                <div style="background: linear-gradient(135deg, #28A745, #20C997); color: white; padding: 1rem; border-radius: 10px; flex: 1; min-width: 200px;">
                    <div style="font-size: 2rem; font-weight: 700;">${sales.length}</div>
                    <div style="font-size: 0.9rem;">إجمالي العمليات</div>
                </div>
                <div style="background: linear-gradient(135deg, #007BFF, #0056B3); color: white; padding: 1rem; border-radius: 10px; flex: 1; min-width: 200px;">
                    <div style="font-size: 2rem; font-weight: 700;">${sales.filter(s => s.action === 'تم الحجز' || s.action === 'الحجز عبر محادثات التطبيق').length}</div>
                    <div style="font-size: 0.9rem;">حجوزات مكتملة</div>
                </div>
                <div style="background: linear-gradient(135deg, #FFC107, #FF9800); color: white; padding: 1rem; border-radius: 10px; flex: 1; min-width: 200px;">
                    <div style="font-size: 2rem; font-weight: 700;">${sales.filter(s => s.action === 'توفير بديل').length}</div>
                    <div style="font-size: 0.9rem;">توفير بديل</div>
                </div>
            </div>
        </div>
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>يوزر الموظف</th>
                        <th>رقم العميل</th>
                        <th>رقم الحجز</th>
                        <th>قناة التواصل</th>
                        <th>ملاحظات</th>
                        <th>الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
    `;

    filteredSales.forEach(sale => {
        // تحديد لون قناة التواصل
        const channelColor = sale.action === 'اتصال' ? 'background: #28A745; color: white;' :
                          sale.action === 'واتس' ? 'background: #25D366; color: white;' :
                          sale.action === 'توفير بديل' ? 'background: #FFC107; color: #333;' :
                          sale.action === 'الحجز عبر محادثات التطبيق' ? 'background: #007BFF; color: white;' :
                          'background: #6c757d; color: white;';

        html += `
            <tr>
                <td style="font-size: 0.85rem;">${sale.date}</td>
                <td>${sale.employeeUser || sale.employeeName || '-'}</td>
                <td style="direction: ltr; font-weight: 600;">${sale.customerNumber || '-'}</td>
                <td style="font-weight: 600;">${sale.bookingNumber || '-'}</td>
                <td><span style="padding: 0.3rem 0.8rem; border-radius: 15px; font-size: 0.85rem; ${channelColor}">${sale.action || '-'}</span></td>
                <td style="max-width: 200px; font-size: 0.85rem;">${sale.notes ? sale.notes.substring(0, 50) + (sale.notes.length > 50 ? '...' : '') : '-'}</td>
                <td>
                    <button class="btn-action btn-view" onclick="viewSaleDetails('${sale.id}')" title="عرض">👁️</button>
                    <button class="btn-action btn-primary" onclick="editSale('${sale.id}')" title="تعديل">✏️</button>
                    <button class="btn-action btn-danger" onclick="deleteSale('${sale.id}')" title="حذف">🗑️</button>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

function filterSales(filter) {
    // Update active tab
    const tabs = document.querySelectorAll('#sales .tab-btn');
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    loadSales(filter);
}

function viewSaleDetails(saleId) {
    const sales = JSON.parse(localStorage.getItem('customerSales') || '[]');
    const sale = sales.find(s => s.id === saleId);

    if (!sale) return;

    const details = `
📈 تفاصيل عملية المبيعات
━━━━━━━━━━━━━━━━━━━━━━
التاريخ: ${sale.date}
الموظف: ${sale.employeeName}
رقم العميل: ${sale.customerNumber}
${sale.bookingNumber ? 'رقم الحجز: ' + sale.bookingNumber : ''}

الإجراء: ${sale.action}
${sale.status ? 'الحالة: ' + sale.status : ''}
${sale.bookingStatus ? 'حالة الحجز: ' + sale.bookingStatus : ''}

تأكيد الاتصال: ${sale.callConfirmed}
تأكيد الواتساب: ${sale.whatsappSent}

${sale.notes ? 'ملاحظات:\n' + sale.notes : ''}

وقت التسجيل: ${sale.recordTime}
    `;

    alert(details);
}

function editSale(saleId) {
    const sales = JSON.parse(localStorage.getItem('customerSales') || '[]');
    const sale = sales.find(s => s.id === saleId);

    if (!sale) return;

    const newAction = prompt('الإجراء الجديد:', sale.action);
    if (newAction !== null) {
        sale.action = newAction;
        localStorage.setItem('customerSales', JSON.stringify(sales));
        loadSales();
    }
}

function deleteSale(saleId) {
    if (!confirm('هل أنت متأكد من حذف هذه العملية؟')) return;

    const sales = JSON.parse(localStorage.getItem('customerSales') || '[]');
    const filteredSales = sales.filter(s => s.id !== saleId);

    localStorage.setItem('customerSales', JSON.stringify(filteredSales));
    alert('✅ تم حذف العملية');
    loadSales();
}

function exportSales() {
    const sales = JSON.parse(localStorage.getItem('customerSales') || '[]');
    if (sales.length === 0) {
        alert('لا توجد بيانات للتصدير');
        return;
    }

    const csvContent = 'data:text/csv;charset=utf-8,'
        + 'التاريخ,الموظف,رقم العميل,رقم الحجز,الإجراء,الحالة,حالة الحجز,الاتصال,الواتساب,ملاحظات\n'
        + sales.map(s =>
            `${s.date},${s.employeeName},${s.customerNumber},${s.bookingNumber || ''},${s.action},${s.status || ''},${s.bookingStatus || ''},${s.callConfirmed},${s.whatsappSent},"${s.notes || ''}"`
        ).join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sales_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==================== TEAM MANAGEMENT ====================

function loadTeamManagement() {
    const team = libraryData.team;
    const container = document.getElementById('teamManagement');

    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>الاسم</th>
                        <th>الدور</th>
                        <th>القسم</th>
                        <th>البريد الإلكتروني</th>
                        <th>الهاتف</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                    </tr>
                </thead>
                <tbody>
                    ${team.map(member => `
                        <tr>
                            <td><strong>${member.name}</strong></td>
                            <td>${member.role}</td>
                            <td>${member.department || '-'}</td>
                            <td>${member.email || '-'}</td>
                            <td>${member.phone || '-'}</td>
                            <td>
                                <span class="status-badge ${member.active ? 'status-resolved' : 'status-pending'}">
                                    ${member.active ? 'نشط' : 'غير نشط'}
                                </span>
                            </td>
                            <td>
                                <button class="btn btn-primary" style="padding:0.3rem 0.8rem; font-size:0.85rem;"
                                        onclick="editTeamMember('${member.id}')">تعديل</button>
                                <button class="btn btn-warning" style="padding:0.3rem 0.8rem; font-size:0.85rem;"
                                        onclick="toggleTeamMemberStatus('${member.id}')">
                                    ${member.active ? 'تعطيل' : 'تفعيل'}
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function showAddTeamModal() {
    const name = prompt('اسم العضو:');
    if (!name) return;

    const role = prompt('الدور (مشرف / موظف دعم / مسؤول جودة):');
    if (!role) return;

    const department = prompt('القسم:');
    const email = prompt('البريد الإلكتروني:');
    const phone = prompt('رقم الهاتف:');

    const newMember = {
        id: 'member_' + Date.now(),
        name: name.trim(),
        role: role.trim(),
        department: department?.trim() || '',
        email: email?.trim() || '',
        phone: phone?.trim() || '',
        active: true
    };

    libraryData.team.push(newMember);
    saveData();
    loadTeamManagement();
    logActivity(`إضافة عضو جديد: ${newMember.name}`);
    alert('✅ تم إضافة العضو بنجاح');
}

function editTeamMember(memberId) {
    const member = libraryData.team.find(m => m.id === memberId);
    if (!member) return;

    const name = prompt('اسم العضو:', member.name);
    if (name === null) return;

    const role = prompt('الدور:', member.role);
    if (role === null) return;

    const department = prompt('القسم:', member.department);
    const email = prompt('البريد الإلكتروني:', member.email);
    const phone = prompt('رقم الهاتف:', member.phone);

    member.name = name.trim();
    member.role = role.trim();
    member.department = department?.trim() || '';
    member.email = email?.trim() || '';
    member.phone = phone?.trim() || '';

    saveData();
    loadTeamManagement();
    logActivity(`تعديل بيانات: ${member.name}`);
    alert('✅ تم تحديث البيانات');
}

function toggleTeamMemberStatus(memberId) {
    const member = libraryData.team.find(m => m.id === memberId);
    if (!member) return;

    member.active = !member.active;
    saveData();
    loadTeamManagement();
    logActivity(`${member.active ? 'تفعيل' : 'تعطيل'} العضو: ${member.name}`);
}

// ==========================================
// DESIGN LIBRARY FUNCTIONS
// ==========================================

// Initialize design library data structure
function initDesignLibrary() {
    if (!localStorage.getItem('designLibrary')) {
        const designData = {
            wireframes: [],
            brandIdentity: [],
            notes: ''
        };
        localStorage.setItem('designLibrary', JSON.stringify(designData));
    }
}

// Get design library data
function getDesignLibraryData() {
    initDesignLibrary();
    return JSON.parse(localStorage.getItem('designLibrary'));
}

// Save design library data
function saveDesignLibraryData(data) {
    localStorage.setItem('designLibrary', JSON.stringify(data));
}

// Upload Wireframe (PDF)
function uploadWireframe(event) {
    const file = event.target.files[0];
    if (!file) return;

    console.log('PDF File selected:', file.name, 'Size:', file.size, 'Type:', file.type);

    if (file.type !== 'application/pdf') {
        alert('⚠️ يرجى رفع ملف PDF فقط\nنوع الملف: ' + file.type);
        return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
        alert('⚠️ حجم الملف كبير جداً: ' + sizeInMB + ' MB\nالحد الأقصى: 10 MB');
        return;
    }

    // Show loading message
    const loadingMsg = alert('⏳ جاري رفع الملف... يرجى الانتظار');

    const reader = new FileReader();

    reader.onerror = function(error) {
        console.error('Error reading file:', error);
        alert('❌ حدث خطأ في قراءة الملف. حاول مرة أخرى.');
    };

    reader.onload = function(e) {
        try {
            const designData = getDesignLibraryData();
            const wireframe = {
                id: Date.now(),
                name: file.name,
                uploadDate: new Date().toISOString(),
                data: e.target.result,
                size: file.size,
                type: 'pdf'
            };

            designData.wireframes.push(wireframe);

            try {
                saveDesignLibraryData(designData);
                displayWireframes();
                logActivity(`رفع Wireframe جديد: ${file.name}`);
                alert('✅ تم رفع Wireframe بنجاح!');
                console.log('PDF uploaded successfully:', file.name);
            } catch (storageError) {
                console.error('LocalStorage error:', storageError);
                alert('❌ خطأ في الحفظ!\n\nالسبب المحتمل: localStorage ممتلئ.\n\nالحل: احذف بعض الملفات القديمة أو استخدم ملف PDF أصغر حجماً.');
                // Remove the failed item
                designData.wireframes.pop();
            }
        } catch (error) {
            console.error('Error processing file:', error);
            alert('❌ حدث خطأ في معالجة الملف: ' + error.message);
        }
    };

    reader.readAsDataURL(file);
    event.target.value = ''; // Reset input
}

// Upload Brand Identity Image
function uploadBrandIdentity(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('⚠️ يرجى رفع صورة فقط');
        return;
    }

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
        alert('⚠️ حجم الصورة كبير جداً. الحد الأقصى 5MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const designData = getDesignLibraryData();
        const brandImage = {
            id: Date.now(),
            name: file.name,
            uploadDate: new Date().toISOString(),
            data: e.target.result,
            size: file.size,
            type: 'image'
        };

        designData.brandIdentity.push(brandImage);
        saveDesignLibraryData(designData);
        displayBrandIdentity();
        logActivity(`رفع صورة هوية بصرية جديدة: ${file.name}`);
        alert('✅ تم رفع الصورة بنجاح!');
    };

    reader.readAsDataURL(file);
    event.target.value = ''; // Reset input
}

// Display Wireframes
function displayWireframes() {
    const container = document.getElementById('wireframesContainer');
    if (!container) return;

    const designData = getDesignLibraryData();

    if (designData.wireframes.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #666;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📄</div>
                <p>لم يتم رفع أي Wireframe بعد</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">اضغط على "رفع Wireframe" لإضافة ملفات PDF</p>
            </div>
        `;
        return;
    }

    container.innerHTML = designData.wireframes.map(wireframe => {
        const date = new Date(wireframe.uploadDate);
        const sizeInMB = (wireframe.size / (1024 * 1024)).toFixed(2);

        return `
            <div style="background: #f8f9fa; border: 2px solid #e0e0e0; border-radius: 12px; padding: 1.5rem; transition: all 0.3s;">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                    <div style="width: 50px; height: 50px; background: linear-gradient(135deg, #E91E8C, #FF1493); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.5rem;">
                        📄
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: #4B3A8C; margin-bottom: 0.3rem;">${wireframe.name}</div>
                        <div style="font-size: 0.85rem; color: #666;">
                            ${date.toLocaleDateString('ar-SA')} - ${sizeInMB} MB
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button onclick="viewWireframe(${wireframe.id})" class="btn btn-primary" style="flex: 1; padding: 0.6rem; font-size: 0.9rem;">
                        👁️ معاينة
                    </button>
                    <button onclick="downloadFile(${wireframe.id}, 'wireframe')" class="btn btn-success" style="flex: 1; padding: 0.6rem; font-size: 0.9rem;">
                        ⬇️ تحميل
                    </button>
                    <button onclick="deleteWireframe(${wireframe.id})" class="btn btn-delete" style="padding: 0.6rem; font-size: 0.9rem;">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Display Brand Identity Images
function displayBrandIdentity() {
    const container = document.getElementById('brandIdentityContainer');
    if (!container) return;

    const designData = getDesignLibraryData();

    if (designData.brandIdentity.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #666;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🎨</div>
                <p>لم يتم رفع أي صورة للهوية البصرية بعد</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">اضغط على "رفع الهوية البصرية" لإضافة صور</p>
            </div>
        `;
        return;
    }

    container.innerHTML = designData.brandIdentity.map(image => {
        const date = new Date(image.uploadDate);
        const sizeInMB = (image.size / (1024 * 1024)).toFixed(2);

        return `
            <div style="background: #f8f9fa; border: 2px solid #e0e0e0; border-radius: 12px; padding: 1rem; transition: all 0.3s;">
                <div style="width: 100%; height: 200px; background: white; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                    <img src="${image.data}" alt="${image.name}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
                </div>

                <div style="font-weight: 600; color: #4B3A8C; margin-bottom: 0.5rem; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${image.name}">
                    ${image.name}
                </div>

                <div style="font-size: 0.8rem; color: #666; margin-bottom: 1rem;">
                    ${date.toLocaleDateString('ar-SA')} - ${sizeInMB} MB
                </div>

                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="viewImage(${image.id})" class="btn btn-primary" style="flex: 1; padding: 0.5rem; font-size: 0.85rem;">
                        👁️ عرض
                    </button>
                    <button onclick="downloadFile(${image.id}, 'brand')" class="btn btn-success" style="flex: 1; padding: 0.5rem; font-size: 0.85rem;">
                        ⬇️
                    </button>
                    <button onclick="deleteBrandImage(${image.id})" class="btn btn-delete" style="padding: 0.5rem; font-size: 0.85rem;">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// View Wireframe (PDF)
function viewWireframe(id) {
    const designData = getDesignLibraryData();
    const wireframe = designData.wireframes.find(w => w.id === id);
    if (!wireframe) return;

    // Open PDF in new window
    const pdfWindow = window.open('', '_blank');
    pdfWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${wireframe.name}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Cairo', sans-serif; background: #f5f7fa; }
                .header { background: linear-gradient(135deg, #4B3A8C, #E91E8C); color: white; padding: 1.5rem; text-align: center; }
                .container { padding: 2rem; }
                iframe { width: 100%; height: calc(100vh - 100px); border: none; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📄 ${wireframe.name}</h1>
                <p style="margin-top: 0.5rem; opacity: 0.9;">Wireframe من Monday.com</p>
            </div>
            <div class="container">
                <iframe src="${wireframe.data}"></iframe>
            </div>
        </body>
        </html>
    `);
}

// View Brand Image
function viewImage(id) {
    const designData = getDesignLibraryData();
    const image = designData.brandIdentity.find(img => img.id === id);
    if (!image) return;

    // Open image in new window
    const imgWindow = window.open('', '_blank');
    imgWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${image.name}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Cairo', sans-serif; background: #1a1a1a; display: flex; flex-direction: column; min-height: 100vh; }
                .header { background: linear-gradient(135deg, #4B3A8C, #E91E8C); color: white; padding: 1rem; text-align: center; }
                .container { flex: 1; display: flex; align-items: center; justify-content: center; padding: 2rem; }
                img { max-width: 100%; max-height: calc(100vh - 150px); object-fit: contain; border-radius: 10px; box-shadow: 0 4px 30px rgba(0,0,0,0.5); }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🎨 ${image.name}</h1>
                <p style="margin-top: 0.5rem; opacity: 0.9;">الهوية البصرية</p>
            </div>
            <div class="container">
                <img src="${image.data}" alt="${image.name}">
            </div>
        </body>
        </html>
    `);
}

// Download File
function downloadFile(id, type) {
    const designData = getDesignLibraryData();
    const file = type === 'wireframe'
        ? designData.wireframes.find(w => w.id === id)
        : designData.brandIdentity.find(img => img.id === id);

    if (!file) return;

    const link = document.createElement('a');
    link.href = file.data;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    logActivity(`تحميل ${type === 'wireframe' ? 'Wireframe' : 'صورة هوية بصرية'}: ${file.name}`);
}

// Delete Wireframe
function deleteWireframe(id) {
    if (!confirm('❌ هل أنت متأكد من حذف هذا Wireframe؟')) return;

    const designData = getDesignLibraryData();
    const wireframe = designData.wireframes.find(w => w.id === id);
    if (!wireframe) return;

    designData.wireframes = designData.wireframes.filter(w => w.id !== id);
    saveDesignLibraryData(designData);
    displayWireframes();
    logActivity(`حذف Wireframe: ${wireframe.name}`);
    alert('✅ تم الحذف بنجاح');
}

// Delete Brand Image
function deleteBrandImage(id) {
    if (!confirm('❌ هل أنت متأكد من حذف هذه الصورة؟')) return;

    const designData = getDesignLibraryData();
    const image = designData.brandIdentity.find(img => img.id === id);
    if (!image) return;

    designData.brandIdentity = designData.brandIdentity.filter(img => img.id !== id);
    saveDesignLibraryData(designData);
    displayBrandIdentity();
    logActivity(`حذف صورة هوية بصرية: ${image.name}`);
    alert('✅ تم الحذف بنجاح');
}

// Save Design Notes
function saveDesignNotes() {
    const notes = document.getElementById('designNotes')?.value || '';
    const designData = getDesignLibraryData();
    designData.notes = notes;
    saveDesignLibraryData(designData);
    logActivity('حفظ ملاحظات التصميم');
    alert('✅ تم حفظ الملاحظات بنجاح!');
}

// Load Design Notes
function loadDesignNotes() {
    const designData = getDesignLibraryData();
    const notesArea = document.getElementById('designNotes');
    if (notesArea) {
        notesArea.value = designData.notes || '';
    }
}

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase first
    await initFirebaseConnection();
    await loadData();
    loadRecentActivity();

    // Load reports if on reports page
    if (document.getElementById('reportsManagement')) {
        loadReports();
    }

    // Load team if on team page
    if (document.getElementById('teamManagement')) {
        loadTeamManagement();
    }

    // Load design library if on design library page
    if (document.getElementById('wireframesContainer')) {
        displayWireframes();
        displayBrandIdentity();
        loadDesignNotes();
    }
});
