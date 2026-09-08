// ============================================================
// DATA STORE - Data will be loaded from Supabase
// ============================================================
const studentData = [];

// ============================================================
// SUPABASE CONFIGURATION
// ============================================================

const SUPABASE_URL = 'https://jpyqywcglcilyfldmcni.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpweXF5d2NnbGNpbHlmbGRtY25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NzMyMjAsImV4cCI6MjEwNDA0OTIyMH0.OeNNAWh913hboWL4bQQYgan8dAl3YFJZjIs9x87Xv8E';

// Initialize Supabase client
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// AUTHENTICATION & SESSION MANAGEMENT
// ============================================================

// Check if user is logged in
function isLoggedIn() {
    return !!sessionStorage.getItem('user') && !!sessionStorage.getItem('access_token');
}

// Get current user role
function getUserRole() {
    return sessionStorage.getItem('userRole') || 'teacher';
}

// Get current user email
function getUserEmail() {
    return sessionStorage.getItem('userEmail') || '';
}

// Get current user name
function getUserName() {
    return sessionStorage.getItem('userName') || '';
}

// Check if user is super admin
function isSuperAdmin() {
    return getUserRole() === 'super_admin';
}

// Check if user can edit data (admin or super admin)
function canEditData() {
    const role = getUserRole();
    return role === 'admin' || role === 'super_admin';
}

// Check if user can view admin features
function canViewAdminFeatures() {
    const role = getUserRole();
    return role === 'admin' || role === 'super_admin';
}

// Check if user can manage users (super admin only)
function canManageUsers() {
    return isSuperAdmin();
}

// Logout function
async function logoutUser() {
    try {
        await sb.auth.signOut();
    } catch (error) {
        console.error('Logout error:', error);
    }
    sessionStorage.clear();
    window.location.href = 'login.html';
}

// ============================================================
// ACCESS LOGGING FUNCTIONS
// ============================================================

// Log student view
async function logStudentView(studentId) {
    const email = getUserEmail();
    if (!email) return;
    
    try {
        await sb
            .from('access_logs')
            .insert({
                user_email: email,
                student_id: studentId,
                action_type: 'view'
            });
    } catch (error) {
        console.error('Error logging view:', error);
    }
}

// Log student edit
async function logStudentEdit(studentId) {
    const email = getUserEmail();
    if (!email) return;
    
    try {
        await sb
            .from('access_logs')
            .insert({
                user_email: email,
                student_id: studentId,
                action_type: 'edit'
            });
    } catch (error) {
        console.error('Error logging edit:', error);
    }
}

// Get access logs with search
async function getAccessLogs(searchTerm = '', page = 1, pageSize = 100) {
    try {
        let query = sb
            .from('access_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .range((page - 1) * pageSize, page * pageSize - 1);
        
        if (searchTerm && searchTerm.trim() !== '') {
            const term = searchTerm.trim().toLowerCase();
            query = query.or(
                `user_email.ilike.%${term}%,` +
                `student_id.ilike.%${term}%,` +
                `action_type.ilike.%${term}%,` +
                `created_at::text.ilike.%${term}%`
            );
        }
        
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching access logs:', error);
        return [];
    }
}

// ============================================================
// USER MANAGEMENT FUNCTIONS (Super Admin Only) - Using Edge Function
// ============================================================

// Helper function to call the admin-auth edge function
async function callAdminFunction(action, data = {}) {
    try {
        const accessToken = sessionStorage.getItem('access_token');
        
        if (!accessToken) {
            throw new Error('No access token found. Please log in again.');
        }
        
        console.log('Calling admin function:', action, 'with token:', accessToken.substring(0, 20) + '...');
        
        const response = await fetch(`${SUPABASE_URL}/functions/v1/admin-auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                action: action,
                ...data
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error('Admin function error response:', result);
            throw new Error(result.error || 'Operation failed');
        }

        return result;
    } catch (error) {
        console.error(`Error calling admin function (${action}):`, error);
        throw error;
    }
}

// Get all users
async function getUsers() {
    try {
        if (!isSuperAdmin()) {
            return [];
        }
        
        const { data, error } = await sb
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching users:', error);
        return [];
    }
}

// Add new user (super admin only)
async function addUser(email, fullName, role) {
    try {
        if (!isSuperAdmin()) {
            return { success: false, error: 'Only Super Admins can create user accounts.' };
        }
        
        if (role === 'super_admin') {
            return { success: false, error: 'Super Admin accounts cannot be created through the UI.' };
        }
        
        const currentUser = JSON.parse(sessionStorage.getItem('user') || '{}');
        
        // Generate temporary password
        const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
        
        // Create user in Supabase Auth
        const { data: authData, error: authError } = await sb.auth.signUp({
            email: email,
            password: tempPassword,
            options: {
                data: {
                    full_name: fullName,
                    role: role,
                    must_change_password: true  // Add this flag
                }
            }
        });
        
        if (authError) throw authError;
        
        // Add user to users table with must_change_password flag
        const { error: userError } = await sb
            .from('users')
            .insert({
                id: authData.user.id,
                email: email,
                full_name: fullName,
                role: role,
                created_by: currentUser.id,
                must_change_password: true  // Add this flag
            });
        
        if (userError) throw userError;
        
        return { 
            success: true, 
            message: `User ${fullName} created successfully!\n\nTemporary Password: ${tempPassword}\n\n⚠️ They will NOT be prompted to change password on first login. Please instruct them to change their password manually.`,
            tempPassword: tempPassword
        };
    } catch (error) {
        console.error('Error adding user:', error);
        return { success: false, error: error.message };
    }
}

// Delete user (super admin only) - Using Edge Function
async function deleteUser(userId, userEmail, userRole) {
    try {
        if (!isSuperAdmin()) {
            return { success: false, error: 'Only Super Admins can delete user accounts.' };
        }
        
        const currentUser = JSON.parse(sessionStorage.getItem('user') || '{}');
        
        // Prevent deleting yourself
        if (userId === currentUser.id) {
            return { success: false, error: 'You cannot delete your own account.' };
        }
        
        // Prevent deleting other super admins
        if (userRole === 'super_admin') {
            return { success: false, error: 'Super Admin accounts cannot be deleted for security reasons.' };
        }
        
        // Get the access token
        const accessToken = sessionStorage.getItem('access_token');
        if (!accessToken) {
            return { success: false, error: 'No access token found. Please log in again.' };
        }
        
        // Call the Edge Function
        const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ userId })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to delete user');
        }
        
        // Refresh the user list
        await renderUserManagement();
        
        return { success: true, message: `User ${userEmail} deleted successfully!` };
    } catch (error) {
        console.error('Error deleting user:', error);
        return { success: false, error: error.message };
    }
}

// Update user role (super admin only) - Using Database Function
async function updateUserRole(userId, newRole) {
    try {
        if (!isSuperAdmin()) {
            return { success: false, error: 'Only Super Admins can change user roles.' };
        }
        
        if (newRole === 'super_admin') {
            return { success: false, error: 'Cannot assign Super Admin role through the UI.' };
        }
        
        // Call the database function to update the role
        const { data, error } = await sb.rpc('update_user_role_by_id', {
            target_user_id: userId,
            new_role: newRole
        });
        
        if (error) throw error;
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to update user role');
        }
        
        return { success: true, message: 'User role updated successfully!' };
    } catch (error) {
        console.error('Error updating user role:', error);
        return { success: false, error: error.message };
    }
}
// ============================================================
// SUPABASE FUNCTIONS (Updated with leave_date)
// ============================================================

// Load students from Supabase
async function loadStudentsFromSupabase() {
    try {
        const { data, error } = await sb
            .from('students')
            .select('*');
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            return data.map(row => ({
                id: row.id,
                lastname: row.lastname || '',
                firstname: row.firstname || '',
                grade: row.grade,
                school: row.school || 'DAIS',
                enrollment_month: row.enrollment_month || 8,
                enrollment_year: row.enrollment_year || 2026,
                leave_date: row.leave_date || null,
                email: row.email || '',
                teacher: row.teacher || '',
                lexile: row.lexile || 'N/A',
                wida_updated: row.wida_updated || row.updated || 'N/A',
                map_updated: row.map_updated || row.updated || 'N/A',
                wrap_updated: row.wrap_updated || row.updated || 'N/A',
                wida: row.wida_composite !== null && row.wida_composite !== undefined ? {
                    listening: row.wida_listening || 0,
                    speaking: row.wida_speaking || 0,
                    reading: row.wida_reading || 0,
                    writing: row.wida_writing || 0,
                    composite: row.wida_composite || 0,
                    oral: row.wida_oral || 0,
                    literacy: row.wida_literacy || 0
                } : null,
                map: row.map_reading !== null && row.map_reading !== undefined ? {
                    reading: row.map_reading || 0,
                    mathematics: row.map_mathematics || 0,
                    language: row.map_language || 0,
                    science: row.map_science || 0
                } : null,
                wrap: row.wrap_overall !== null && row.wrap_overall !== undefined ? {
                    overall: row.wrap_overall || 0,
                    organization: row.wrap_organization || 0,
                    support: row.wrap_support || 0,
                    structure: row.wrap_structure || 0,
                    wordChoice: row.wrap_wordchoice || 0,
                    mechanics: row.wrap_mechanics || 0,
                    totalRaw: row.wrap_totalraw || 0
                } : null,
                observations: row.observation_text ? {
                    text: row.observation_text,
                } : null
            }));
        }
        return [];
    } catch (error) {
        console.error('Error loading students from Supabase:', error);
        return [];
    }
}

// Save student to Supabase (updated with leave_date)
async function saveStudentToSupabase(student) {
    try {
        const data = {
            id: student.id,
            lastname: student.lastname || '',
            firstname: student.firstname || '',
            grade: student.grade,
            school: student.school || 'DAIS',
            enrollment_month: student.enrollment_month || 8,
            enrollment_year: student.enrollment_year || 2026,
            leave_date: student.leave_date || null,
            email: student.email || '',
            teacher: student.teacher || '',
            lexile: student.lexile || 'N/A',
            wida_updated: student.wida_updated || '',
            map_updated: student.map_updated || '',
            wrap_updated: student.wrap_updated || '',
            wida_listening: student.wida?.listening || null,
            wida_speaking: student.wida?.speaking || null,
            wida_reading: student.wida?.reading || null,
            wida_writing: student.wida?.writing || null,
            wida_composite: student.wida?.composite || null,
            wida_oral: student.wida?.oral || null,
            wida_literacy: student.wida?.literacy || null,
            map_reading: student.map?.reading || null,
            map_mathematics: student.map?.mathematics || null,
            map_language: student.map?.language || null,
            map_science: student.map?.science || null,
            wrap_overall: student.wrap?.overall || null,
            wrap_organization: student.wrap?.organization || null,
            wrap_support: student.wrap?.support || null,
            wrap_structure: student.wrap?.structure || null,
            wrap_wordchoice: student.wrap?.wordChoice || null,
            wrap_mechanics: student.wrap?.mechanics || null,
            wrap_totalraw: student.wrap?.totalRaw || null,
            observation_text: student.observations?.text || null,
        };

        const { error } = await sb
            .from('students')
            .upsert(data, { onConflict: 'id' });
        
        if (error) throw error;
        
        console.log('Student saved to Supabase:', student.id);
        return true;
    } catch (error) {
        console.error('Error saving student to Supabase:', error);
        return false;
    }
}

// Delete student from Supabase
async function deleteStudentFromSupabase(studentId) {
    try {
        const { error } = await sb
            .from('students')
            .delete()
            .eq('id', studentId);
        
        if (error) throw error;
        
        console.log('Student deleted from Supabase:', studentId);
        return true;
    } catch (error) {
        console.error('Error deleting student from Supabase:', error);
        return false;
    }
}

// Load all students from Supabase and update local data
async function loadAndSyncFromSupabase() {
    const students = await loadStudentsFromSupabase();
    
    if (students.length > 0) {
        studentData.length = 0;
        students.forEach(s => studentData.push(s));
        console.log('Data loaded from Supabase:', students.length, 'students');
        return true;
    } else {
        console.log('No data in Supabase, keeping local data');
        return false;
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// Check if a student is currently enrolled
function isEnrolled(student) {
    if (!student.leave_date) return true;
    
    const leaveDate = new Date(student.leave_date);
    const today = new Date();
    
    // If leave date is in the future, they're still enrolled
    return leaveDate > today;
}

// Get students with enrollment filtering
function getFilteredStudents(filterType = 'enrolled') {
    if (filterType === 'all') return [...studentData];
    
    if (filterType === 'enrolled') {
        return studentData.filter(s => isEnrolled(s));
    }
    
    if (filterType === 'non-enrolled') {
        return studentData.filter(s => !isEnrolled(s));
    }
    
    return studentData;
}

// Calculate EAL status based on WIDA composite score
function calculateStatus(student) {
    // If no WIDA data, return 'not-tested'
    if (!student.wida || student.wida === null) {
        return 'not-tested';
    }
    
    const composite = student.wida.composite || 0;
    
    if (composite >= 0 && composite <= 3.5) {
        return 'active';
    } else if (composite >= 3.6 && composite <= 4.9) {
        return 'consultative';
    } else if (composite >= 5.0 && composite <= 6.0) {
        return 'exited';
    } else {
        return 'not-tested';
    }
}

// WIDA Helper - Get strongest domain label
function getDomainLabel(student) {
    if (!student.wida) return 'No Data';
    const domains = ['listening', 'speaking', 'reading', 'writing'];
    const highest = domains.reduce((a, b) => student.wida[a] > student.wida[b] ? a : b);
    const labels = {
        listening: 'Listening',
        speaking: 'Speaking',
        reading: 'Reading',
        writing: 'Writing'
    };
    return labels[highest] || 'Student';
}

// WIDA Helper - Get icon for strongest domain
function getDomainIcon(student) {
    if (!student.wida) return 'fas fa-times-circle';
    const domains = ['listening', 'speaking', 'reading', 'writing'];
    const highest = domains.reduce((a, b) => student.wida[a] > student.wida[b] ? a : b);
    const icons = {
        listening: 'fas fa-headphones',
        speaking: 'fas fa-microphone',
        reading: 'fas fa-book-open',
        writing: 'fas fa-pen-fancy'
    };
    return icons[highest] || 'fas fa-user';
}

// Check if student has data for a specific test
function hasTestData(student, testType) {
    if (testType === 'wida') return student.wida !== null && student.wida !== undefined;
    if (testType === 'map') return student.map !== null && student.map !== undefined;
    if (testType === 'wrap') return student.wrap !== null && student.wrap !== undefined;
    return false;
}

// Search filter helper
function applySearchFilter(data, searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        return data;
    }
    
    const term = searchTerm.trim().toLowerCase();
    return data.filter(student => {
        const fullName = (student.firstname + ' ' + student.lastname).trim().toLowerCase();
        const nameMatch = fullName.includes(term);
        const idMatch = (student.id || '').toLowerCase().includes(term);
        return nameMatch || idMatch;
    });
}

// Filter helper - Apply grade and status filters
function applyBasicFilters(data, gradeFilter, statusFilter) {
    let filtered = [...data];
    
    if (gradeFilter !== 'all') {
        filtered = filtered.filter(s => s.grade === parseInt(gradeFilter));
    }
    
    if (statusFilter !== 'all') {
        if (statusFilter === 'not-tested' || statusFilter === 'noData') {
            // For noData, we'll handle this in the specific test filter functions
        } else {
            filtered = filtered.filter(s => calculateStatus(s) === statusFilter);
        }
    }
    
    return filtered;
}

// Helper function to extract year from date string
function extractYearFromDate(dateString) {
    if (!dateString) return null;
    let year = dateString.match(/\b(20\d{2})\b/)?.[0];
    if (!year) {
        const twoDigitMatch = dateString.match(/\b(\d{2})\b(?!.*\d{2})/);
        if (twoDigitMatch) {
            year = '20' + twoDigitMatch[1];
        }
    }
    if (year) {
        const yearNum = parseInt(year);
        if (yearNum >= 2000 && yearNum <= 2030) {
            return yearNum;
        }
    }
    return null;
}

function extractMonthFromDate(dateString) {
    if (!dateString) return 1;
    const monthMap = {
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
        'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
    };
    const monthMatch = dateString.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
    if (monthMatch) {
        return monthMap[monthMatch[0].toLowerCase()] || 1;
    }
    const numMonth = dateString.match(/\b(\d{1,2})\b/)?.[0];
    if (numMonth) {
        const month = parseInt(numMonth);
        if (month >= 1 && month <= 12) return month;
    }
    return 1;
}

// Get students by year and status - uses enrollment_year and leave_date
function getStudentsByYearAndStatus(fromDate, toDate, statusFilter = 'all') {
    // Check if the first parameter is a single year (number)
    if (typeof fromDate === 'number' && !isNaN(fromDate)) {
        const snapshotYear = fromDate;
        const snapshotDate = new Date(snapshotYear, 7, 1); // August 1 of that year
        
        // Get all students
        let allStudents = [...studentData];
        
        // Filter students who were enrolled at the snapshot date
        const enrolledStudents = allStudents.filter(student => {
            const enrollmentYear = student.enrollment_year || 2026;
            const leaveDate = student.leave_date;
            
            // Student must be enrolled by the snapshot date
            if (enrollmentYear > snapshotYear) return false;
            
            // If student has a leave date, they must have left AFTER the snapshot date
            if (leaveDate) {
                const leaveYear = extractYearFromDate(leaveDate);
                const leaveMonth = extractMonthFromDate(leaveDate);
                const leaveDateObj = new Date(leaveYear, leaveMonth - 1, 1);
                
                // If they left before or on the snapshot date, they are NOT counted
                if (leaveDateObj <= snapshotDate) {
                    return false;
                }
            }
            
            return true;
        });
        
        // Filter by status if needed
        if (statusFilter !== 'all') {
            return enrolledStudents.filter(s => calculateStatus(s) === statusFilter);
        }
        
        return enrolledStudents;
    }
    
    // Original behavior: date range
    let students = getStudentsByYearRangeAndGrade(fromDate, toDate, 'all');
    
    if (statusFilter !== 'all') {
        students = students.filter(s => calculateStatus(s) === statusFilter);
    }
    
    return students;
}

// Get students by year range and grade - point-in-time snapshots
function getStudentsByYearRangeAndGrade(fromDate, toDate, gradeFilter) {
    let allStudents = [...studentData];
    
    // Filter by grade
    if (gradeFilter !== 'all') {
        allStudents = allStudents.filter(s => s.grade === parseInt(gradeFilter));
    }
    
    // If no from/to dates, return all students
    if (!fromDate || !toDate) {
        return allStudents;
    }
    
    // Extract the snapshot year from the toDate
    const snapshotYear = parseInt(toDate.match(/\d{4}/)?.[0]);
    if (!snapshotYear) return allStudents;
    
    const snapshotDate = new Date(snapshotYear, 7, 1); // August 1 of that year
    
    // Filter students who were enrolled at the snapshot date
    const result = allStudents.filter(student => {
        const enrollmentYear = student.enrollment_year || 2026;
        const leaveDate = student.leave_date;
        
        // Student must be enrolled by the snapshot date
        if (enrollmentYear > snapshotYear) return false;
        
        // If student has a leave date, they must have left AFTER the snapshot date
        if (leaveDate) {
            const leaveYear = extractYearFromDate(leaveDate);
            const leaveMonth = extractMonthFromDate(leaveDate);
            const leaveDateObj = new Date(leaveYear, leaveMonth - 1, 1);
            
            // If they left before or on the snapshot date, they are NOT counted
            if (leaveDateObj <= snapshotDate) {
                return false;
            }
        }
        
        return true;
    });
    
    return result;
}

// ============================================================
// WIDA TAB FUNCTIONS
// ============================================================

function renderWIDACards(filteredData) {
    const grid = document.getElementById('wida-card-grid');
    const countSpan = document.getElementById('wida-count');
    
    if (!grid) return;
    
    // Filter to ONLY enrolled students
    const enrolledData = filteredData.filter(s => isEnrolled(s));
    
    if (enrolledData.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <i class="fas fa-search"></i>
                <p>No students match your filters</p>
                <p class="no-results-sub">Try adjusting your filters</p>
            </div>
        `;
        if (countSpan) countSpan.textContent = '0';
        return;
    }
    
    if (countSpan) countSpan.textContent = enrolledData.length;
    
    grid.innerHTML = enrolledData.map(student => {
        const hasData = hasTestData(student, 'wida');
        const status = calculateStatus(student);
        const fullName = (student.firstname + ' ' + student.lastname).trim() || student.id;
        
        return `
        <article class="data-card" data-student-id="${student.id}">
            <div class="card-title">
                <span>WIDA Scores</span>
                <i class="fas fa-language"></i>
            </div>
            <div class="student-name">${fullName}</div>
            <div class="student-id">ID: ${student.id} · Grade ${student.grade}</div>
            <div class="student-status-wrapper">
                <div class="student-status status-${status}">
                    <i class="fas fa-circle"></i> ${status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
                ${!hasData ? `<span class="not-tested-badge"><i class="fas fa-times-circle"></i> Not Tested</span>` : ''}
            </div>
            ${hasData ? `
            <div class="score-row">
                <span class="score-item">
                    <span class="label">Overall Score</span>
                    <span class="value" title="1-6 scale: 1=Entering, 6=Reaching">${student.wida.composite}</span>
                </span>
                <span class="score-item">
                    <span class="label">Lexile</span>
                    <span class="value" title="Reading level measure">${student.lexile !== 'N/A' ? student.lexile : 'N/A'}</span>
                </span>
            </div>
            <div class="score-details">
                <span class="detail-item"><span class="detail-label">Speaking:</span> ${student.wida.speaking}</span>
                <span class="detail-item"><span class="detail-label">Listening:</span> ${student.wida.listening}</span>
                <span class="detail-item"><span class="detail-label">Reading:</span> ${student.wida.reading}</span>
                <span class="detail-item"><span class="detail-label">Writing:</span> ${student.wida.writing}</span>
                <span class="detail-item"><span class="detail-label">Oral:</span> ${student.wida.oral}</span>
                <span class="detail-item"><span class="detail-label">Literacy:</span> ${student.wida.literacy}</span>
            </div>
            ` : `
            <div class="no-data-placeholder">
                <i class="fas fa-info-circle"></i>
                <span>No scores available</span>
            </div>
            `}
            <div class="stats-meta">
                <i class="far fa-clock"></i> Updated: ${student.wida_updated || 'N/A'}
            </div>
        </article>
    `}).join('');
}

function filterAndSortWIDA() {
    const gradeFilter = document.getElementById('wida-grade-filter')?.value || 'all';
    const statusFilter = document.getElementById('wida-status-filter')?.value || 'all';
    const sortField = document.getElementById('wida-sort')?.value || 'composite';
    const order = document.getElementById('wida-order')?.value || 'asc';
    const searchTerm = document.getElementById('wida-search')?.value || '';
    
    let filtered = applyBasicFilters(studentData, gradeFilter, statusFilter);
    
    // Handle status filtering including 'not-tested'
    if (statusFilter === 'not-tested' || statusFilter === 'noData') {
        filtered = filtered.filter(s => !hasTestData(s, 'wida'));
    } else if (statusFilter !== 'all') {
        filtered = filtered.filter(s => calculateStatus(s) === statusFilter);
    }
    
    // Apply search filter
    filtered = applySearchFilter(filtered, searchTerm);
    
    // Separate students with data and without data
    const withData = filtered.filter(s => hasTestData(s, 'wida'));
    const withoutData = filtered.filter(s => !hasTestData(s, 'wida'));
    
    // Sort students with data
    withData.sort((a, b) => {
        let aVal = a.wida[sortField] || 0;
        let bVal = b.wida[sortField] || 0;
        return order === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    // Combine: students with data first, then no data students
    const sortedData = [...withData, ...withoutData];
    
    renderWIDACards(sortedData);
}

function resetWIDAFilters() {
    document.getElementById('wida-grade-filter').value = 'all';
    document.getElementById('wida-status-filter').value = 'all';
    document.getElementById('wida-sort').value = 'composite';
    document.getElementById('wida-order').value = 'asc';
    const searchInput = document.getElementById('wida-search');
    if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('wida-clear-search');
        if (clearBtn) clearBtn.classList.remove('visible');
    }
    filterAndSortWIDA();
}

// ============================================================
// MAP TAB FUNCTIONS
// ============================================================

function renderMAPCards(filteredData) {
    const grid = document.getElementById('map-card-grid');
    const countSpan = document.getElementById('map-count');
    
    if (!grid) return;
    
    // Filter to ONLY enrolled students
    const enrolledData = filteredData.filter(s => isEnrolled(s));
    
    if (enrolledData.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <i class="fas fa-search"></i>
                <p>No students match your filters</p>
                <p class="no-results-sub">Try adjusting your filters</p>
            </div>
        `;
        if (countSpan) countSpan.textContent = '0';
        return;
    }
    
    if (countSpan) countSpan.textContent = enrolledData.length;
    
    grid.innerHTML = enrolledData.map(student => {
        const hasData = hasTestData(student, 'map');
        const status = calculateStatus(student);
        const fullName = (student.firstname + ' ' + student.lastname).trim() || student.id;
        
        return `
        <article class="data-card" data-student-id="${student.id}">
            <div class="card-title">
                <span>MAP Scores</span>
                <i class="fas fa-chart-line"></i>
            </div>
            <div class="student-name">${fullName}</div>
            <div class="student-id">ID: ${student.id} · Grade ${student.grade}</div>
            <div class="student-status-wrapper">
                <div class="student-status status-${status}">
                    <i class="fas fa-circle"></i> ${status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
                ${!hasData ? `<span class="not-tested-badge"><i class="fas fa-times-circle"></i> Not Tested</span>` : ''}
            </div>
            ${hasData ? `
            <div class="score-row">
                <span class="score-item">
                    <span class="label">Lexile</span>
                    <span class="value" title="Reading level measure">${student.lexile !== 'N/A' ? student.lexile : 'N/A'}</span>
                </span>
            </div>
            <div class="score-details">
                <span class="detail-item"><span class="detail-label">Reading:</span> ${student.map.reading}</span>
                <span class="detail-item"><span class="detail-label">Mathematics:</span> ${student.map.mathematics}</span>
                <span class="detail-item"><span class="detail-label">Language Use:</span> ${student.map.language}</span>
                <span class="detail-item"><span class="detail-label">Science:</span> ${student.map.science}</span>
            </div>
            ` : `
            <div class="no-data-placeholder">
                <i class="fas fa-info-circle"></i>
                <span>No scores available</span>
            </div>
            `}
            <div class="stats-meta">
                <i class="far fa-clock"></i> Updated: ${student.map_updated || 'N/A'}
            </div>
        </article>
    `}).join('');
}

function filterAndSortMAP() {
    const gradeFilter = document.getElementById('map-grade-filter')?.value || 'all';
    const statusFilter = document.getElementById('map-status-filter')?.value || 'all';
    const sortField = document.getElementById('map-sort')?.value || 'reading';
    const order = document.getElementById('map-order')?.value || 'asc';
    const lexileMin = parseInt(document.getElementById('map-lexile-min')?.value) || 0;
    const lexileMax = parseInt(document.getElementById('map-lexile-max')?.value) || 9999;
    const searchTerm = document.getElementById('map-search')?.value || '';
    
    let filtered = applyBasicFilters(studentData, gradeFilter, statusFilter);
    
    if (statusFilter === 'not-tested' || statusFilter === 'noData') {
        filtered = filtered.filter(s => !hasTestData(s, 'map'));
    } else if (statusFilter !== 'all') {
        filtered = filtered.filter(s => calculateStatus(s) === statusFilter);
    }
    
    filtered = applySearchFilter(filtered, searchTerm);
    
    filtered = filtered.filter(s => {
        const lexileNum = parseInt(s.lexile);
        if (isNaN(lexileNum)) return true;
        return lexileNum >= lexileMin && lexileNum <= lexileMax;
    });
    
    const withData = filtered.filter(s => hasTestData(s, 'map'));
    const withoutData = filtered.filter(s => !hasTestData(s, 'map'));
    
    withData.sort((a, b) => {
        let aVal = a.map[sortField] || 0;
        let bVal = b.map[sortField] || 0;
        return order === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    const sortedData = [...withData, ...withoutData];
    renderMAPCards(sortedData);
}

function resetMAPFilters() {
    document.getElementById('map-grade-filter').value = 'all';
    document.getElementById('map-status-filter').value = 'all';
    document.getElementById('map-sort').value = 'reading';
    document.getElementById('map-order').value = 'asc';
    document.getElementById('map-lexile-min').value = '';
    document.getElementById('map-lexile-max').value = '';
    const searchInput = document.getElementById('map-search');
    if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('map-clear-search');
        if (clearBtn) clearBtn.classList.remove('visible');
    }
    filterAndSortMAP();
}

// ============================================================
// WRAP TAB FUNCTIONS
// ============================================================

function renderWRAPCards(filteredData) {
    const grid = document.getElementById('wrap-card-grid');
    const countSpan = document.getElementById('wrap-count');
    
    if (!grid) return;
    
    // Filter to ONLY enrolled students
    const enrolledData = filteredData.filter(s => isEnrolled(s));
    
    if (enrolledData.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <i class="fas fa-search"></i>
                <p>No students match your filters</p>
                <p class="no-results-sub">Try adjusting your filters</p>
            </div>
        `;
        if (countSpan) countSpan.textContent = '0';
        return;
    }
    
    if (countSpan) countSpan.textContent = enrolledData.length;
    
    grid.innerHTML = enrolledData.map(student => {
        const hasData = hasTestData(student, 'wrap');
        const status = calculateStatus(student);
        const fullName = (student.firstname + ' ' + student.lastname).trim() || student.id;
        
        return `
        <article class="data-card" data-student-id="${student.id}">
            <div class="card-title">
                <span>WrAP Scores</span>
                <i class="fas fa-feather-alt"></i>
            </div>
            <div class="student-name">${fullName}</div>
            <div class="student-id">ID: ${student.id} · Grade ${student.grade}</div>
            <div class="student-status-wrapper">
                <div class="student-status status-${status}">
                    <i class="fas fa-circle"></i> ${status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
                ${!hasData ? `<span class="not-tested-badge"><i class="fas fa-times-circle"></i> Not Tested</span>` : ''}
            </div>
            ${hasData ? `
            <div class="score-row">
                <span class="score-item">
                    <span class="label">Overall</span>
                    <span class="value" title="1-6 scale">${student.wrap.overall}</span>
                </span>
                <span class="score-item">
                    <span class="label">Total Raw</span>
                    <span class="value" title="Total raw score">${student.wrap.totalRaw}</span>
                </span>
            </div>
            <div class="score-details">
                <span class="detail-item"><span class="detail-label">Organization:</span> ${student.wrap.organization}</span>
                <span class="detail-item"><span class="detail-label">Support:</span> ${student.wrap.support}</span>
                <span class="detail-item"><span class="detail-label">Structure:</span> ${student.wrap.structure}</span>
                <span class="detail-item"><span class="detail-label">Word Choice:</span> ${student.wrap.wordChoice}</span>
                <span class="detail-item"><span class="detail-label">Mechanics:</span> ${student.wrap.mechanics}</span>
            </div>
            ` : `
            <div class="no-data-placeholder">
                <i class="fas fa-info-circle"></i>
                <span>No scores available</span>
            </div>
            `}
            <div class="stats-meta">
                <i class="far fa-clock"></i> Updated: ${student.wrap_updated || 'N/A'}
            </div>
        </article>
    `}).join('');
}

function filterAndSortWRAP() {
    const gradeFilter = document.getElementById('wrap-grade-filter')?.value || 'all';
    const statusFilter = document.getElementById('wrap-status-filter')?.value || 'all';
    const sortField = document.getElementById('wrap-sort')?.value || 'overall';
    const order = document.getElementById('wrap-order')?.value || 'asc';
    const searchTerm = document.getElementById('wrap-search')?.value || '';
    
    let filtered = applyBasicFilters(studentData, gradeFilter, statusFilter);
    
    if (statusFilter === 'not-tested' || statusFilter === 'noData') {
        filtered = filtered.filter(s => !hasTestData(s, 'wrap'));
    } else if (statusFilter !== 'all') {
        filtered = filtered.filter(s => calculateStatus(s) === statusFilter);
    }
    
    filtered = applySearchFilter(filtered, searchTerm);
    
    const withData = filtered.filter(s => hasTestData(s, 'wrap'));
    const withoutData = filtered.filter(s => !hasTestData(s, 'wrap'));
    
    withData.sort((a, b) => {
        let aVal = a.wrap[sortField] || 0;
        let bVal = b.wrap[sortField] || 0;
        return order === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    const sortedData = [...withData, ...withoutData];
    renderWRAPCards(sortedData);
}

function resetWRAPFilters() {
    document.getElementById('wrap-grade-filter').value = 'all';
    document.getElementById('wrap-status-filter').value = 'all';
    document.getElementById('wrap-sort').value = 'overall';
    document.getElementById('wrap-order').value = 'asc';
    const searchInput = document.getElementById('wrap-search');
    if (searchInput) {
        searchInput.value = '';
        const clearBtn = document.getElementById('wrap-clear-search');
        if (clearBtn) clearBtn.classList.remove('visible');
    }
    filterAndSortWRAP();
}

// ============================================================
// ADMIN TABLE FUNCTIONS
// ============================================================

function renderAdminTable() {
    const tbody = document.getElementById('admin-table-body');
    const countSpan = document.getElementById('admin-count');
    
    if (!tbody) return;
    
    const gradeFilter = document.getElementById('admin-grade-filter')?.value || 'all';
    const statusFilter = document.getElementById('admin-status-filter')?.value || 'all';
    const enrollmentFilter = document.getElementById('admin-enrollment-filter')?.value || 'all';
    const searchTerm = document.getElementById('admin-search')?.value || '';
    
    let filtered = [...studentData];
    
    // Filter by grade
    if (gradeFilter !== 'all') {
        filtered = filtered.filter(s => s.grade === parseInt(gradeFilter));
    }
    
    // Filter by status
    if (statusFilter !== 'all') {
        if (statusFilter === 'not-tested') {
            filtered = filtered.filter(s => !s.wida || s.wida === null);
        } else {
            filtered = filtered.filter(s => calculateStatus(s) === statusFilter);
        }
    }
    
    // Filter by enrollment
    if (enrollmentFilter === 'enrolled') {
        filtered = filtered.filter(s => isEnrolled(s));
    } else if (enrollmentFilter === 'non-enrolled') {
        filtered = filtered.filter(s => !isEnrolled(s));
    }
    // 'all' shows everyone
    
    // Filter by search
    if (searchTerm.trim() !== '') {
        const term = searchTerm.trim().toLowerCase();
        filtered = filtered.filter(s => {
            const fullName = (s.firstname + ' ' + s.lastname).trim().toLowerCase();
            return fullName.includes(term) || s.id.toLowerCase().includes(term);
        });
    }
    
    // Sort: Grade > Status > Alphabetical
    filtered.sort((a, b) => {
        if (a.grade !== b.grade) {
            return a.grade - b.grade;
        }
        const statusA = calculateStatus(a);
        const statusB = calculateStatus(b);
        const statusOrder = { 'active': 0, 'consultative': 1, 'exited': 2, 'not-tested': 3 };
        if (statusA !== statusB) {
            return (statusOrder[statusA] || 3) - (statusOrder[statusB] || 3);
        }
        const nameA = (a.firstname + ' ' + a.lastname).trim() || '';
        const nameB = (b.firstname + ' ' + b.lastname).trim() || '';
        return nameA.localeCompare(nameB);
    });
    
    if (countSpan) countSpan.textContent = filtered.length;
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="33" style="text-align: center; padding: 2rem; color: #8a9fb3;">
                    <i class="fas fa-search" style="font-size: 1.2rem; display: block; margin-bottom: 0.5rem;"></i>
                    No students match your filters
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filtered.map(student => {
        const status = calculateStatus(student);
        const statusDisplay = status.charAt(0).toUpperCase() + status.slice(1);
        const enrolled = isEnrolled(student);
        const rowClass = enrolled ? '' : 'inactive-row';
        
        const firstName = student.firstname || '';
        const lastName = student.lastname || '';
        
        const wida = student.wida;
        const widaOverall = wida ? wida.composite : 'N/A';
        const widaSpeaking = wida ? wida.speaking : 'N/A';
        const widaListening = wida ? wida.listening : 'N/A';
        const widaWriting = wida ? wida.writing : 'N/A';
        const widaReading = wida ? wida.reading : 'N/A';
        const widaOral = wida ? wida.oral : 'N/A';
        const widaLiteracy = wida ? wida.literacy : 'N/A';
        
        const map = student.map;
        const mapLanguage = map ? map.language : 'N/A';
        const mapReading = map ? map.reading : 'N/A';
        const mapMath = map ? map.mathematics : 'N/A';
        const mapScience = map ? map.science : 'N/A';
        
        const wrap = student.wrap;
        const wrapOverall = wrap ? wrap.overall : 'N/A';
        const wrapOrganization = wrap ? wrap.organization : 'N/A';
        const wrapSupport = wrap ? wrap.support : 'N/A';
        const wrapStructure = wrap ? wrap.structure : 'N/A';
        const wrapWordChoice = wrap ? wrap.wordChoice : 'N/A';
        const wrapMechanics = wrap ? wrap.mechanics : 'N/A';
        const wrapTotalRaw = wrap ? wrap.totalRaw : 'N/A';
        
        const enrolledDisplay = enrolled ? '✅ Yes' : '❌ No';
        
        return `
            <tr class="${rowClass}" data-student-id="${student.id}">
                <td class="sticky-col col-id">${student.id}</td>
                <td class="sticky-col col-lastname">${lastName}</td>
                <td class="sticky-col col-firstname">${firstName}</td>
                <td>${student.grade}</td>
                <td>${student.school || 'DAIS'}</td>
                <td>${enrolledDisplay}</td>
                <td>${student.leave_date || 'N/A'}</td>
                <td><span class="status-badge status-${status}">${statusDisplay}</span></td>
                <td>${student.wida_updated || 'N/A'}</td>
                <td>${widaOverall}</td>
                <td>${widaSpeaking}</td>
                <td>${widaListening}</td>
                <td>${widaWriting}</td>
                <td>${widaReading}</td>
                <td>${widaOral}</td>
                <td>${widaLiteracy}</td>
                <td>${student.map_updated || 'N/A'}</td>
                <td>${mapLanguage}</td>
                <td>${mapReading}</td>
                <td>${mapMath}</td>
                <td>${mapScience}</td>
                <td>${student.lexile || 'N/A'}</td>
                <td>${student.wrap_updated || 'N/A'}</td>
                <td>${wrapOverall}</td>
                <td>${wrapOrganization}</td>
                <td>${wrapSupport}</td>
                <td>${wrapStructure}</td>
                <td>${wrapWordChoice}</td>
                <td>${wrapMechanics}</td>
                <td>${wrapTotalRaw}</td>
                <td>${student.enrollment_month || 'N/A'}</td>
                <td>${student.enrollment_year || 'N/A'}</td>
                <td>
                    ${canEditData() ? `
                        <button class="admin-edit-btn" data-student-id="${student.id}">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                    ` : 'View Only'}
                </td>
            </tr>
        `;
    }).join('');
    
    document.querySelectorAll('.admin-edit-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const studentId = this.dataset.studentId;
            openEditStudentModal(studentId);
        });
    });
}

// ============================================================
// ADMIN FILTER FUNCTIONS
// ============================================================

function filterAndSortAdmin() {
    renderAdminTable();
}

function resetAdminFilters() {
    document.getElementById('admin-grade-filter').value = 'all';
    document.getElementById('admin-status-filter').value = 'all';
    document.getElementById('admin-enrollment-filter').value = 'all';
    document.getElementById('admin-search').value = '';
    renderAdminTable();
}

// ============================================================
// ACCESS HISTORY FUNCTIONS
// ============================================================

// Render access history (updated to show deletions)
async function renderAccessHistory() {
    const tbody = document.getElementById('history-table-body');
    const countSpan = document.getElementById('history-count');
    const headerCountSpan = document.getElementById('access-history-count');
    const searchTerm = document.getElementById('history-search')?.value || '';
    
    if (!tbody) return;
    
    if (!canViewAdminFeatures()) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: #8a9fb3;">
                    <i class="fas fa-lock" style="display: block; font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                    Access restricted to administrators only
                </td>
            </tr>
        `;
        if (headerCountSpan) headerCountSpan.textContent = '0 entries';
        if (countSpan) countSpan.textContent = '0';
        return;
    }
    
    const logs = await getAccessLogs(searchTerm);
    
    // Update counts
    if (countSpan) countSpan.textContent = logs.length;
    if (headerCountSpan) headerCountSpan.textContent = logs.length + ' entries';
    
    if (logs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: #8a9fb3;">
                    <i class="fas fa-search" style="display: block; font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                    No logs found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = logs.map(log => {
        let actionIcon, actionColor, actionLabel;
        
        if (log.action_type === 'delete') {
            actionIcon = 'fa-trash-alt';
            actionColor = '#b91c1c';
            actionLabel = 'Deleted';
        } else if (log.action_type === 'view') {
            actionIcon = 'fa-eye';
            actionColor = '#4b6a8b';
            actionLabel = 'View';
        } else if (log.action_type === 'edit') {
            actionIcon = 'fa-edit';
            actionColor = '#b9770e';
            actionLabel = 'Edit';
        } else {
            actionIcon = 'fa-circle';
            actionColor = '#8a9fb3';
            actionLabel = log.action_type || 'Unknown';
        }
        
        const timestamp = new Date(log.created_at).toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        return `
            <tr>
                <td>${log.user_email ? log.user_email.split('@')[0] : 'Unknown'}</td>
                <td>${log.user_email || 'Unknown'}</td>
                <td><strong>${log.student_id}</strong></td>
                <td>
                    <span style="color: ${actionColor};">
                        <i class="fas ${actionIcon}"></i> ${actionLabel}
                    </span>
                </td>
                <td style="font-size: 0.75rem; color: #5b6f84;">${timestamp}</td>
            </tr>
        `;
    }).join('');
}

// ============================================================
// USER MANAGEMENT RENDERING (Super Admin Only)
// ============================================================

// Render user management (Super Admin only)
async function renderUserManagement() {
    const tbody = document.getElementById('user-table-body');
    const container = document.getElementById('user-management');
    const countSpan = document.getElementById('user-management-count');
    
    if (!tbody || !container) return;
    
    // Check permissions
    if (!isSuperAdmin()) {
        container.innerHTML = `
            <div class="access-denied">
                <i class="fas fa-lock"></i>
                <h4>Access Denied</h4>
                <p>Only Super Admins can access user management.</p>
            </div>
        `;
        return;
    }
    
    const users = await getUsers();
    const currentUser = JSON.parse(sessionStorage.getItem('user') || '{}');
    
    // Update count in collapsible header
    if (countSpan) {
        countSpan.textContent = users.length + ' users';
    }
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: #8a9fb3;">
                    <i class="fas fa-users" style="display: block; font-size: 1.5rem; margin-bottom: 0.5rem;"></i>
                    No users found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const isSelf = user.id === currentUser.id;
        const roleDisplay = user.role.split('_').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
        
        const roleClass = user.role === 'super_admin' ? 'super_admin' : 
                         user.role === 'admin' ? 'admin' : 'teacher';
        
        // Determine if actions should be shown
        const showActions = !isSelf && (
            (user.role === 'teacher' || user.role === 'admin')
        );
        
        return `
            <tr>
                <td>${user.full_name} ${isSelf ? '<span style="font-size: 0.7rem; color: #4b6a8b;">(You)</span>' : ''}</td>
                <td>${user.email}</td>
                <td>
                    <span class="role-badge ${roleClass}">
                        ${roleDisplay}
                    </span>
                </td>
                <td>${user.is_active ? '✅ Active' : '❌ Inactive'}</td>
                <td style="font-size: 0.75rem; color: #5b6f84;">
                    ${user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                </td>
                <td>
                    ${showActions ? `
                        ${user.role !== 'super_admin' ? `
                            <button class="user-action-btn ${user.role === 'admin' ? 'demote' : 'promote'}" 
                                    data-userid="${user.id}" data-role="${user.role === 'admin' ? 'teacher' : 'admin'}">
                                ${user.role === 'admin' ? 'Demote' : 'Promote'}
                            </button>
                        ` : ''}
                        <button class="user-action-btn delete" 
                                data-userid="${user.id}" data-email="${user.email}" data-role="${user.role}">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : isSelf ? 'Cannot modify self' : ''}
                </td>
            </tr>
        `;
    }).join('');
    
    // Add event listeners for role change buttons
    document.querySelectorAll('.user-action-btn.promote, .user-action-btn.demote').forEach(btn => {
        btn.addEventListener('click', async function() {
            const userId = this.dataset.userid;
            const newRole = this.dataset.role;
            if (confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
                const result = await updateUserRole(userId, newRole);
                if (result.success) {
                    alert(result.message);
                    renderUserManagement();
                } else {
                    alert('Error: ' + result.error);
                }
            }
        });
    });
    
    // Add event listeners for delete buttons
    document.querySelectorAll('.user-action-btn.delete').forEach(btn => {
        btn.addEventListener('click', async function() {
            const userId = this.dataset.userid;
            const userEmail = this.dataset.email;
            const userRole = this.dataset.role;
            
            if (confirm(`Are you sure you want to delete user ${userEmail}? This action cannot be undone.`)) {
                const result = await deleteUser(userId, userEmail, userRole);
                if (result.success) {
                    alert(result.message);
                    renderUserManagement();
                } else {
                    alert('Error: ' + result.error);
                }
            }
        });
    });
}

// ============================================================
// COLLAPSIBLE SECTIONS TOGGLE
// ============================================================


function toggleCollapsible(sectionName) {
    const content = document.getElementById(sectionName + '-content');
    const arrow = document.getElementById(sectionName + '-arrow');
    
    if (!content) return;
    
    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        if (arrow) arrow.classList.add('rotated');
    } else {
        content.style.display = 'none';
        if (arrow) arrow.classList.remove('rotated');
    }
}


// ============================================================
// ADD USER FORM HANDLER
// ============================================================

// In your add-user event listener (where the message is displayed)
document.getElementById('add-user-btn')?.addEventListener('click', async function() {
    const fullName = document.getElementById('user-fullname').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const role = document.getElementById('user-role').value;
    const messageDiv = document.getElementById('add-user-message');
    
    if (!fullName || !email) {
        messageDiv.style.display = 'block';
        messageDiv.style.color = '#b91c1c';
        messageDiv.textContent = 'Please fill in all required fields.';
        return;
    }
    
    this.disabled = true;
    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    
    const result = await addUser(email, fullName, role);
    
    if (result.success) {
        messageDiv.style.display = 'block';
        messageDiv.style.color = '#0d7c4a';
        messageDiv.innerHTML = `
            ✅ ${result.message}
            <br><br>
            <strong>Temporary Password:</strong> <code style="background: #eef2f7; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 1.1rem;">${result.tempPassword}</code>
            <br>
            <span style="font-size: 0.85rem; color: #5b6f84; display: block; margin-top: 0.5rem;">
                ⚠️ <strong>Important:</strong> The user will NOT be prompted to change their password on first login. 
                Please instruct them to change their password manually in their profile settings.
            </span>
        `;
        document.getElementById('user-fullname').value = '';
        document.getElementById('user-email').value = '';
        renderUserManagement();
    } else {
        messageDiv.style.display = 'block';
        messageDiv.style.color = '#b91c1c';
        messageDiv.textContent = '❌ ' + result.error;
    }
    
    this.disabled = false;
    this.innerHTML = '<i class="fas fa-plus"></i> Add User';
});

// ============================================================
// STATS TAB FUNCTIONS
// ============================================================

let statsCharts = {};

// Get available years from student data - starts from 2025
function getAvailableYears() {
    const years = new Set();
    const START_YEAR = 2025;
    
    years.add(2025);
    years.add(2026);
    
    studentData.forEach(student => {
        const year = student.enrollment_year || 2026;
        if (year >= START_YEAR) {
            years.add(year);
        }
    });
    
    return Array.from(years).sort((a, b) => a - b);
}

// Render summary cards
function renderStatsSummary(students) {
    const total = students.length;
    const distribution = getStatusDistribution(students);
    const activeCount = distribution.active || 0;
    const consultativeCount = distribution.consultative || 0;
    const exitedCount = distribution.exited || 0;
    
    document.getElementById('stat-total-students').textContent = total;
    document.getElementById('stat-active-count').textContent = activeCount;
    document.getElementById('stat-consultative-count').textContent = consultativeCount;
    document.getElementById('stat-exited-count').textContent = exitedCount;
    
    const compositeScores = students
        .map(s => s.wida?.composite)
        .filter(v => v !== undefined && v !== null && !isNaN(v));
    if (compositeScores.length > 0) {
        const avg = compositeScores.reduce((a, b) => a + b, 0) / compositeScores.length;
        document.getElementById('stat-avg-composite').textContent = avg.toFixed(2);
    } else {
        document.getElementById('stat-avg-composite').textContent = 'N/A';
    }
    
    const years = getAvailableYears();
    if (years.length >= 2) {
        const latestYear = years[years.length - 1];
        const previousYear = years[years.length - 2];
        const latestStudents = getStudentsByYearAndStatus(latestYear);
        const previousStudents = getStudentsByYearAndStatus(previousYear);
        const latestAvg = latestStudents
            .map(s => s.wida?.composite)
            .filter(v => v !== undefined && v !== null && !isNaN(v));
        const previousAvg = previousStudents
            .map(s => s.wida?.composite)
            .filter(v => v !== undefined && v !== null && !isNaN(v));
        
        if (latestAvg.length > 0 && previousAvg.length > 0) {
            const latest = latestAvg.reduce((a, b) => a + b, 0) / latestAvg.length;
            const previous = previousAvg.reduce((a, b) => a + b, 0) / previousAvg.length;
            const growth = ((latest - previous) / previous * 100);
            document.getElementById('stat-growth').textContent = (growth > 0 ? '+' : '') + growth.toFixed(1) + '%';
        } else {
            document.getElementById('stat-growth').textContent = 'N/A';
        }
    } else {
        document.getElementById('stat-growth').textContent = 'N/A';
    }
}

// Get status distribution for a dataset
function getStatusDistribution(students) {
    const distribution = { active: 0, consultative: 0, exited: 0 };
    students.forEach(student => {
        if (!student.wida) return;
        const status = calculateStatus(student);
        if (distribution[status] !== undefined) {
            distribution[status]++;
        }
    });
    return distribution;
}

// Create a pie chart
function createPieChart(canvasId, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    if (statsCharts[canvasId]) {
        statsCharts[canvasId].destroy();
        delete statsCharts[canvasId];
    }
    
    const labels = ['Active', 'Consultative', 'Exited'];
    const values = [data.active || 0, data.consultative || 0, data.exited || 0];
    
    if (values.every(v => v === 0)) {
        return null;
    }
    
    const chart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors || ['#b91c1c', '#b9770e', '#0d7c4a'],
                borderColor: ['#ffffff', '#ffffff', '#ffffff'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 8,
                        font: { size: 10 },
                        boxWidth: 10,
                        boxHeight: 10,
                        useBorderRadius: true,
                        borderRadius: 3
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
                            return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
                        }
                    }
                }
            }
        }
    });
    
    statsCharts[canvasId] = chart;
    return chart;
}

// Global variable to track chart type
let currentChartType = 'bar';

function createYearOverYearChart(canvasId, domain, years) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    
    const parent = ctx.parentElement;
    
    if (statsCharts[canvasId]) {
        statsCharts[canvasId].destroy();
        delete statsCharts[canvasId];
    }
    
    if (!years || years.length === 0) {
        const fromDate = document.getElementById('stats-from-date')?.value || null;
        const toDate = document.getElementById('stats-to-date')?.value || null;
        const trendGrade = document.getElementById('stats-trend-grade')?.value || 'all';
        const students = getStudentsByYearRangeAndGrade(fromDate, toDate, trendGrade);
        const availableYears = new Set();
        students.forEach(s => {
            const year = s.enrollment_year || 2026;
            if (year >= 2025) {
                availableYears.add(year);
            }
        });
        years = Array.from(availableYears).sort((a, b) => a - b);
    }
    
    if (!years || years.length === 0) {
        parent.innerHTML = `<canvas id="${canvasId}"></canvas>`;
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = 'text-align: center; color: #8a9fb3; padding: 2rem;';
        msgDiv.textContent = 'No data available for this year range';
        parent.appendChild(msgDiv);
        return null;
    }
    
    let canvas = document.getElementById(canvasId);
    if (!canvas) {
        parent.innerHTML = `<canvas id="${canvasId}"></canvas>`;
        canvas = document.getElementById(canvasId);
    }
    
    const statuses = ['active', 'consultative', 'exited'];
    const statusLabels = ['Active', 'Consultative', 'Exited'];
    const colors = ['#b91c1c', '#b9770e', '#0d7c4a'];
    
    const fromDate = document.getElementById('stats-from-date')?.value || null;
    const toDate = document.getElementById('stats-to-date')?.value || null;
    const trendGrade = document.getElementById('stats-trend-grade')?.value || 'all';
    
    const datasets = statuses.map((status, index) => {
        const data = {};
        const counts = {};
        years.forEach(year => {
            const allStudents = getStudentsByYearRangeAndGrade(fromDate, toDate, trendGrade);
            const yearStudents = allStudents.filter(s => {
                const enrollmentYear = s.enrollment_year || 2026;
                return enrollmentYear === year;
            });
            
            let count = 0;
            yearStudents.forEach(student => {
                if (!student.wida) return;
                const score = student.wida[domain];
                if (score === undefined || score === null) return;
                
                let studentStatus;
                if (score >= 0 && score <= 3.5) {
                    studentStatus = 'active';
                } else if (score >= 3.6 && score <= 4.9) {
                    studentStatus = 'consultative';
                } else if (score >= 5.0 && score <= 6.0) {
                    studentStatus = 'exited';
                } else {
                    return;
                }
                
                if (studentStatus === status) {
                    count++;
                }
            });
            counts[year] = count;
            const total = yearStudents.length;
            data[year] = total > 0 ? (count / total) * 100 : 0;
        });
        
        const isLine = currentChartType === 'line';
        const color = colors[index];
        const countData = years.map(year => counts[year] || 0);
        
        return {
            label: statusLabels[index],
            data: years.map(year => data[year] || 0),
            backgroundColor: isLine ? color + '33' : color,
            borderColor: color,
            borderWidth: isLine ? 3 : 1,
            borderRadius: isLine ? 0 : 4,
            tension: 0.3,
            pointRadius: isLine ? 4 : 0,
            pointBackgroundColor: color,
            pointBorderColor: color,
            pointBorderWidth: isLine ? 2 : 0,
            fill: isLine ? true : false,
            barPercentage: 0.7,
            _counts: countData
        };
    });
    
    const chartType = currentChartType === 'line' ? 'line' : 'bar';
    
    const chart = new Chart(canvas, {
        type: chartType,
        data: {
            labels: years,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 10 },
                        boxWidth: 12,
                        boxHeight: 12,
                        useBorderRadius: true,
                        borderRadius: 3
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const dataset = context.dataset;
                            const value = context.parsed.y;
                            const count = dataset._counts ? dataset._counts[context.dataIndex] : 0;
                            return context.dataset.label + ': ' + value.toFixed(1) + '% (' + count + ' students)';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { 
                        font: { size: 9 },
                        callback: function(value) {
                            return value + '%';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Percentage of Students',
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: { font: { size: 9 } }
                }
            }
        }
    });
    
    statsCharts[canvasId] = chart;
    return chart;
}

// Toggle chart type
function toggleChartType(type) {
    if (currentChartType === type) return;
    currentChartType = type;
    
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    
    createOverallTrendChart();
    
    const trendDomains = ['speaking', 'listening', 'writing', 'reading', 'oral', 'literacy'];
    const trendIds = ['chart-trend-speaking', 'chart-trend-listening', 'chart-trend-writing', 'chart-trend-reading', 'chart-trend-oral', 'chart-trend-literacy'];
    
    trendDomains.forEach((domain, index) => {
        const canvas = document.getElementById(trendIds[index]);
        if (!canvas) {
            const parent = document.getElementById(trendIds[index])?.parentElement;
            if (parent) {
                parent.innerHTML = `<canvas id="${trendIds[index]}"></canvas>`;
            }
        }
        createYearOverYearChart(trendIds[index], domain, getAvailableYears());
    });
}

// Create the Overall Trend chart
function createOverallTrendChart() {
    const container = document.getElementById('chart-trend-overall')?.parentElement;
    if (!container) return;
    
    let ctx = document.getElementById('chart-trend-overall');
    
    if (statsCharts['chart-trend-overall']) {
        statsCharts['chart-trend-overall'].destroy();
        delete statsCharts['chart-trend-overall'];
    }
    
    if (!ctx) {
        container.innerHTML = '<canvas id="chart-trend-overall"></canvas>';
        ctx = document.getElementById('chart-trend-overall');
    }
    
    const fromDate = document.getElementById('stats-from-date')?.value || null;
    const toDate = document.getElementById('stats-to-date')?.value || null;
    const trendGrade = document.getElementById('stats-trend-grade')?.value || 'all';
    
    let students = getStudentsByYearRangeAndGrade(fromDate, toDate, trendGrade);
    
    const yearsSet = new Set();
    students.forEach(s => {
        const year = s.enrollment_year || 2026;
        if (year >= 2025) {
            yearsSet.add(year);
        }
    });
    const years = Array.from(yearsSet).sort((a, b) => a - b);
    
    if (years.length === 0) {
        container.innerHTML = '<canvas id="chart-trend-overall"></canvas>';
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = 'text-align: center; color: #8a9fb3; padding: 2rem;';
        msgDiv.textContent = 'No data available for this year range';
        container.appendChild(msgDiv);
        return;
    }
    
    const statuses = ['active', 'consultative', 'exited'];
    const statusLabels = ['Active', 'Consultative', 'Exited'];
    const colors = ['#b91c1c', '#b9770e', '#0d7c4a'];
    
    const datasets = statuses.map((status, index) => {
        const data = {};
        const counts = {};
        years.forEach(year => {
            const yearStudents = students.filter(s => {
                const enrollmentYear = s.enrollment_year || 2026;
                return enrollmentYear === year;
            });
            
            let count = 0;
            yearStudents.forEach(student => {
                if (!student.wida) return;
                const score = student.wida.composite;
                if (score === undefined || score === null) return;
                
                let studentStatus;
                if (score >= 0 && score <= 3.5) {
                    studentStatus = 'active';
                } else if (score >= 3.6 && score <= 4.9) {
                    studentStatus = 'consultative';
                } else if (score >= 5.0 && score <= 6.0) {
                    studentStatus = 'exited';
                } else {
                    return;
                }
                
                if (studentStatus === status) {
                    count++;
                }
            });
            counts[year] = count;
            const total = yearStudents.length;
            data[year] = total > 0 ? (count / total) * 100 : 0;
        });
        
        const isLine = currentChartType === 'line';
        const color = colors[index];
        const countData = years.map(year => counts[year] || 0);
        
        return {
            label: statusLabels[index],
            data: years.map(year => data[year] || 0),
            backgroundColor: isLine ? color + '33' : color,
            borderColor: color,
            borderWidth: isLine ? 3 : 1,
            borderRadius: isLine ? 0 : 4,
            tension: 0.3,
            pointRadius: isLine ? 5 : 0,
            pointBackgroundColor: color,
            pointBorderColor: color,
            pointBorderWidth: isLine ? 2 : 0,
            fill: isLine ? true : false,
            barPercentage: 0.7,
            _counts: countData
        };
    });
    
    const chartType = currentChartType === 'line' ? 'line' : 'bar';
    
    const chart = new Chart(ctx, {
        type: chartType,
        data: {
            labels: years,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 12 },
                        boxWidth: 16,
                        boxHeight: 16,
                        useBorderRadius: true,
                        borderRadius: 3
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const dataset = context.dataset;
                            const value = context.parsed.y;
                            const count = dataset._counts ? dataset._counts[context.dataIndex] : 0;
                            return context.dataset.label + ': ' + value.toFixed(1) + '% (' + count + ' students)';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { 
                        font: { size: 11 },
                        callback: function(value) {
                            return value + '%';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Percentage of Students',
                        font: { size: 12 }
                    }
                },
                x: {
                    ticks: { font: { size: 11 } }
                }
            }
        }
    });
    
    statsCharts['chart-trend-overall'] = chart;
}

function updateStats() {
    console.log('=== Updating Stats ===');
    
    const fromMonth = document.getElementById('stats-from-month')?.value || '08';
    const fromYear = document.getElementById('stats-from-year')?.value || 'all';
    const fromDate = fromYear !== 'all' ? fromYear + '-' + fromMonth + '-01' : null;
    
    const toMonth = document.getElementById('stats-to-month')?.value || '08';
    const toYear = document.getElementById('stats-to-year')?.value || 'all';
    const toDate = toYear !== 'all' ? toYear + '-' + toMonth + '-01' : null;
    
    const gradeFilter = document.getElementById('stats-grade-filter')?.value || 'all';
    const trendGrade = document.getElementById('stats-trend-grade')?.value || 'all';
    
    let pieStudents = studentData.filter(s => s.wida !== null && s.wida !== undefined);
    
    if (gradeFilter !== 'all') {
        pieStudents = pieStudents.filter(s => s.grade === parseInt(gradeFilter));
    }
    
    renderStatsSummary(pieStudents);
    
    const domainColors = ['#b91c1c', '#b9770e', '#0d7c4a'];
    const domains = ['composite', 'speaking', 'listening', 'writing', 'reading', 'oral', 'literacy'];
    const chartIds = ['chart-overall', 'chart-speaking', 'chart-listening', 'chart-writing', 'chart-reading', 'chart-oral', 'chart-literacy'];
    
    domains.forEach((domain, index) => {
        const domainStatusCounts = { active: 0, consultative: 0, exited: 0 };
        
        pieStudents.forEach(student => {
            if (!student.wida) return;
            const score = student.wida[domain];
            if (score === undefined || score === null) return;
            
            let status;
            if (score >= 0 && score <= 3.5) {
                status = 'active';
            } else if (score >= 3.6 && score <= 4.9) {
                status = 'consultative';
            } else if (score >= 5.0 && score <= 6.0) {
                status = 'exited';
            } else {
                return;
            }
            
            domainStatusCounts[status]++;
        });
        
        const pieData = {
            active: domainStatusCounts.active || 0,
            consultative: domainStatusCounts.consultative || 0,
            exited: domainStatusCounts.exited || 0
        };
        
        createPieChart(chartIds[index], pieData, domainColors);
    });
    
    let trendStudents = getStudentsByYearRangeAndGrade(fromDate, toDate, trendGrade);
    
    const availableYears = new Set();
    trendStudents.forEach(s => {
        const year = s.enrollment_year || 2026;
        if (year >= 2025) {
            availableYears.add(year);
        }
    });
    const sortedYears = Array.from(availableYears).sort((a, b) => a - b);

    console.log('Available years:', sortedYears);
    
    createOverallTrendChart();
    
    const trendDomains = ['speaking', 'listening', 'writing', 'reading', 'oral', 'literacy'];
    const trendIds = ['chart-trend-speaking', 'chart-trend-listening', 'chart-trend-writing', 'chart-trend-reading', 'chart-trend-oral', 'chart-trend-literacy'];
    
    trendDomains.forEach((domain, index) => {
        createYearOverYearChart(trendIds[index], domain, sortedYears);
    });
}

function initializeStats() {
    const years = getAvailableYears();
    console.log('Available years for dropdown:', years);
    
    const yearFrom = document.getElementById('stats-from-year');
    const yearTo = document.getElementById('stats-to-year');
    
    yearFrom.innerHTML = '';
    yearTo.innerHTML = '';
    
    if (years.length > 0) {
        years.forEach(year => {
            const optionFrom = document.createElement('option');
            optionFrom.value = year;
            optionFrom.textContent = year;
            yearFrom.appendChild(optionFrom);
            
            const optionTo = document.createElement('option');
            optionTo.value = year;
            optionTo.textContent = year;
            yearTo.appendChild(optionTo);
        });
        
        yearFrom.value = years[0];
        yearTo.value = years[years.length - 1];
    } else {
        const placeholderFrom = document.createElement('option');
        placeholderFrom.value = '2025';
        placeholderFrom.textContent = '2025';
        yearFrom.appendChild(placeholderFrom);
        
        const placeholderTo = document.createElement('option');
        placeholderTo.value = '2026';
        placeholderTo.textContent = '2026';
        yearTo.appendChild(placeholderTo);
        
        yearFrom.value = '2025';
        yearTo.value = '2026';
    }
    
    document.getElementById('stats-grade-filter').value = 'all';
    document.getElementById('stats-trend-grade').value = 'all';
    
    updateStats();
}

function resetStatsFilters() {
    const years = getAvailableYears();
    if (years.length > 0) {
        document.getElementById('stats-from-year').value = years[0];
        document.getElementById('stats-to-year').value = years[years.length - 1];
    } else {
        document.getElementById('stats-from-year').value = '2025';
        document.getElementById('stats-to-year').value = '2026';
    }
    document.getElementById('stats-grade-filter').value = 'all';
    document.getElementById('stats-trend-grade').value = 'all';
    updateStats();
}

// ============================================================
// COLLAPSIBLE TREND SECTION
// ============================================================

function toggleTrendSection() {
    const content = document.getElementById('trend-content');
    const arrow = document.getElementById('trend-arrow');
    const toggleBtn = document.getElementById('trend-toggle-btn');
    const toggleIcon = document.getElementById('trend-toggle-icon');
    const isVisible = content.style.display !== 'none';
    
    if (isVisible) {
        content.style.display = 'none';
        arrow.classList.remove('rotated');
        toggleIcon.className = 'fas fa-chevron-down';
        toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Expand';
    } else {
        content.style.display = 'block';
        arrow.classList.add('rotated');
        toggleIcon.className = 'fas fa-chevron-up';
        toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Collapse';
        updateStats();
    }
}

function toggleTrendHeader() {
    toggleTrendSection();
}

// ============================================================
// ADD STUDENT FUNCTIONS
// ============================================================

function openAddStudentModal() {
    const modal = document.getElementById('add-student-modal');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    const deleteBtn = document.getElementById('delete-student-btn');
    if (deleteBtn) {
        deleteBtn.style.display = 'none';
    }
    
    // Populate enrollment year options
    const yearSelect = document.getElementById('add-enrollment-year');
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 2; year <= currentYear + 1; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === 2026) option.selected = true;
        yearSelect.appendChild(option);
    }
    
    document.getElementById('add-student-form').reset();
}

function closeAddStudentModal() {
    const modal = document.getElementById('add-student-modal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    
    const deleteBtn = document.getElementById('delete-student-btn');
    if (deleteBtn) {
        deleteBtn.style.display = 'none';
        deleteBtn.onclick = null;
    }
    
    document.getElementById('add-wida-test-btn').style.display = 'none';
    document.getElementById('add-map-test-btn').style.display = 'none';
    document.getElementById('add-wrap-test-btn').style.display = 'none';
    
    document.getElementById('add-id').disabled = false;
    document.querySelector('#add-student-modal .modal-student-info h2').innerHTML = '<i class="fas fa-user-plus"></i> Add New Student';
    document.querySelector('#add-student-modal .modal-student-meta').textContent = 'Fill in the student information below';
    const submitBtn = document.querySelector('#add-student-form button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Add Student';
    submitBtn.style.background = '#0d7c4a';
    
    const hiddenField = document.getElementById('edit-student-id');
    if (hiddenField) {
        hiddenField.remove();
    }
    
    document.getElementById('add-student-form').reset();
}

// ============================================================
// EDIT STUDENT FUNCTIONS
// ============================================================

function openEditStudentModal(studentId) {
    const student = studentData.find(s => s.id === studentId);
    if (!student) {
        alert('Student not found!');
        return;
    }
    
    const modal = document.getElementById('add-student-modal');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    document.querySelector('#add-student-modal .modal-student-info h2').innerHTML = '<i class="fas fa-user-edit"></i> Edit Student';
    document.querySelector('#add-student-modal .modal-student-meta').textContent = 'Update the student information below';
    
    const submitBtn = document.querySelector('#add-student-form button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Student';
    submitBtn.style.background = '#4b6a8b';
    
    const deleteBtn = document.getElementById('delete-student-btn');
    if (deleteBtn) {
        deleteBtn.style.display = 'inline-flex';
        deleteBtn.onclick = function() {
            deleteStudent(studentId);
        };
    }
    
    if (canEditData()) {
        document.getElementById('add-wida-test-btn').style.display = 'inline-flex';
        document.getElementById('add-map-test-btn').style.display = 'inline-flex';
        document.getElementById('add-wrap-test-btn').style.display = 'inline-flex';
    }
    
    let hiddenField = document.getElementById('edit-student-id');
    if (!hiddenField) {
        hiddenField = document.createElement('input');
        hiddenField.type = 'hidden';
        hiddenField.id = 'edit-student-id';
        document.getElementById('add-student-form').appendChild(hiddenField);
    }
    hiddenField.value = studentId;
    
    document.getElementById('add-id').value = student.id;
    document.getElementById('add-id').disabled = true;
    document.getElementById('add-firstname').value = student.firstname || '';
    document.getElementById('add-lastname').value = student.lastname || '';
    document.getElementById('add-grade').value = student.grade;
    document.getElementById('add-school').value = student.school || 'DAIS';
    document.getElementById('add-enrollment-month').value = student.enrollment_month || 8;
    document.getElementById('add-enrollment-year').value = student.enrollment_year || 2026;
    document.getElementById('add-leave-date').value = student.leave_date || '';
    document.getElementById('add-email').value = student.email || '';
    document.getElementById('add-teacher').value = student.teacher || '';
    document.getElementById('add-lexile').value = student.lexile || '';
    
    if (student.wida) {
        document.getElementById('add-wida-overall').value = student.wida.composite || '';
        document.getElementById('add-wida-speaking').value = student.wida.speaking || '';
        document.getElementById('add-wida-listening').value = student.wida.listening || '';
        document.getElementById('add-wida-writing').value = student.wida.writing || '';
        document.getElementById('add-wida-reading').value = student.wida.reading || '';
        document.getElementById('add-wida-oral').value = student.wida.oral || '';
        document.getElementById('add-wida-literacy').value = student.wida.literacy || '';
    } else {
        document.getElementById('add-wida-overall').value = '';
        document.getElementById('add-wida-speaking').value = '';
        document.getElementById('add-wida-listening').value = '';
        document.getElementById('add-wida-writing').value = '';
        document.getElementById('add-wida-reading').value = '';
        document.getElementById('add-wida-oral').value = '';
        document.getElementById('add-wida-literacy').value = '';
    }
    
    if (student.map) {
        document.getElementById('add-map-reading').value = student.map.reading || '';
        document.getElementById('add-map-math').value = student.map.mathematics || '';
        document.getElementById('add-map-language').value = student.map.language || '';
        document.getElementById('add-map-science').value = student.map.science || '';
    } else {
        document.getElementById('add-map-reading').value = '';
        document.getElementById('add-map-math').value = '';
        document.getElementById('add-map-language').value = '';
        document.getElementById('add-map-science').value = '';
    }
    
    if (student.wrap) {
        document.getElementById('add-wrap-overall').value = student.wrap.overall || '';
        document.getElementById('add-wrap-organization').value = student.wrap.organization || '';
        document.getElementById('add-wrap-support').value = student.wrap.support || '';
        document.getElementById('add-wrap-structure').value = student.wrap.structure || '';
        document.getElementById('add-wrap-wordchoice').value = student.wrap.wordChoice || '';
        document.getElementById('add-wrap-mechanics').value = student.wrap.mechanics || '';
        document.getElementById('add-wrap-totalraw').value = student.wrap.totalRaw || '';
    } else {
        document.getElementById('add-wrap-overall').value = '';
        document.getElementById('add-wrap-organization').value = '';
        document.getElementById('add-wrap-support').value = '';
        document.getElementById('add-wrap-structure').value = '';
        document.getElementById('add-wrap-wordchoice').value = '';
        document.getElementById('add-wrap-mechanics').value = '';
        document.getElementById('add-wrap-totalraw').value = '';
    }
    
    document.getElementById('add-wida-date').value = student.wida_updated || '';
    document.getElementById('add-map-date').value = student.map_updated || '';
    document.getElementById('add-wrap-date').value = student.wrap_updated || '';
    
    if (student.observations) {
        document.getElementById('add-observations').value = student.observations.text || '';
    } else {
        document.getElementById('add-observations').value = '';
    }
}

async function updateStudentInData(studentId, formData) {
    const studentIndex = studentData.findIndex(s => s.id === studentId);
    if (studentIndex === -1) {
        alert('Student not found!');
        return;
    }
    
    const student = studentData[studentIndex];
    
    student.firstname = formData.firstName || '';
    student.lastname = formData.lastName || '';
    student.grade = parseInt(formData.grade);
    student.school = formData.school || 'DAIS';
    student.enrollment_month = parseInt(document.getElementById('add-enrollment-month').value) || 8;
    student.enrollment_year = parseInt(document.getElementById('add-enrollment-year').value) || 2026;
    student.leave_date = document.getElementById('add-leave-date').value || null;
    student.email = formData.email || '';
    student.teacher = formData.teacher || '';
    student.lexile = formData.lexile || 'N/A';
    
    student.wida_updated = document.getElementById('add-wida-date').value || '';
    student.map_updated = document.getElementById('add-map-date').value || '';
    student.wrap_updated = document.getElementById('add-wrap-date').value || '';
    
    if (formData.widaOverall) {
        if (!student.wida) student.wida = {};
        student.wida.listening = parseFloat(formData.widaListening) || 0;
        student.wida.speaking = parseFloat(formData.widaSpeaking) || 0;
        student.wida.reading = parseFloat(formData.widaReading) || 0;
        student.wida.writing = parseFloat(formData.widaWriting) || 0;
        student.wida.composite = parseFloat(formData.widaOverall) || 0;
        student.wida.oral = parseFloat(formData.widaOral) || 0;
        student.wida.literacy = parseFloat(formData.widaLiteracy) || 0;
    } else {
        student.wida = null;
    }
    
    if (formData.mapReading) {
        if (!student.map) student.map = {};
        student.map.reading = parseInt(formData.mapReading) || 0;
        student.map.mathematics = parseInt(formData.mapMath) || 0;
        student.map.language = parseInt(formData.mapLanguage) || 0;
        student.map.science = parseInt(formData.mapScience) || 0;
    } else {
        student.map = null;
    }
    
    if (formData.wrapOverall) {
        if (!student.wrap) student.wrap = {};
        student.wrap.overall = parseFloat(formData.wrapOverall) || 0;
        student.wrap.organization = parseFloat(formData.wrapOrganization) || 0;
        student.wrap.support = parseFloat(formData.wrapSupport) || 0;
        student.wrap.structure = parseFloat(formData.wrapStructure) || 0;
        student.wrap.wordChoice = parseFloat(formData.wrapWordChoice) || 0;
        student.wrap.mechanics = parseFloat(formData.wrapMechanics) || 0;
        student.wrap.totalRaw = parseInt(formData.wrapTotalRaw) || 0;
    } else {
        student.wrap = null;
    }
    
    if (formData.observations) {
        if (!student.observations) student.observations = {};
        student.observations.text = formData.observations;
    } else {
        student.observations = null;
    }
    
    await saveStudentToSupabase(student);
    
    // Log the edit
    await logStudentEdit(studentId);
    
    renderAdminTable();
    closeAddStudentModal();
    
    document.getElementById('add-id').disabled = false;
    document.querySelector('#add-student-modal .modal-student-info h2').innerHTML = '<i class="fas fa-user-plus"></i> Add New Student';
    document.querySelector('#add-student-modal .modal-student-meta').textContent = 'Fill in the student information below';
    const submitBtn = document.querySelector('#add-student-form button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Add Student';
    submitBtn.style.background = '#0d7c4a';
    
    alert('Student ' + (student.firstname + ' ' + student.lastname).trim() + ' updated successfully!');
}

// ============================================================
// DELETE STUDENT FUNCTION
// ============================================================

// Delete student function with logging
async function deleteStudent(studentId) {
    const student = studentData.find(s => s.id === studentId);
    if (!student) {
        alert('Student not found!');
        return;
    }
    
    const fullName = (student.firstname + ' ' + student.lastname).trim() || student.id;
    
    if (confirm(`Are you sure you want to delete ${fullName}'s data?\n\nAll of their information will be permanently deleted and cannot be recovered.`)) {
        
        // ============================================================
        // LOG THE DELETION BEFORE DELETING
        // ============================================================
        const email = getUserEmail();
        if (email) {
            try {
                await sb
                    .from('access_logs')
                    .insert({
                        user_email: email,
                        student_id: studentId + ' (DELETED: ' + fullName + ')',
                        action_type: 'delete'
                    });
                console.log('Deletion logged for student:', studentId);
            } catch (logError) {
                console.error('Error logging deletion:', logError);
                // Continue with deletion even if logging fails
            }
        }
        
        // Now delete the student
        const studentIndex = studentData.findIndex(s => s.id === studentId);
        if (studentIndex !== -1) {
            await deleteStudentFromSupabase(studentId);
            studentData.splice(studentIndex, 1);
            renderAdminTable();
            closeAddStudentModal();
            alert(`${fullName} has been deleted successfully.`);
        }
    }
}

// ============================================================
// STUDENT DETAIL MODAL
// ============================================================

function showStudentModal(studentId) {
    const student = studentData.find(s => s.id === studentId);
    if (!student) return;
    
    // Log the view
    logStudentView(studentId);
    
    const modal = document.getElementById('student-modal');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    const fullName = (student.firstname + ' ' + student.lastname).trim() || student.id;
    document.getElementById('modal-student-name').textContent = fullName;
    document.getElementById('modal-grade').textContent = student.grade || 'N/A';
    document.getElementById('modal-school').textContent = student.school || 'DAIS';
    document.getElementById('modal-email').textContent = student.email || 'N/A';
    document.getElementById('modal-teacher').textContent = student.teacher || 'N/A';
    document.getElementById('modal-lexile').textContent = student.lexile || 'N/A';
    document.getElementById('modal-enrollment').textContent = `${student.enrollment_month || 'N/A'}/${student.enrollment_year || 'N/A'}`;
    
    const status = calculateStatus(student);
    const statusDisplay = status.charAt(0).toUpperCase() + status.slice(1);
    const statusBadge = document.getElementById('modal-status-badge');
    statusBadge.className = `modal-status-badge status-${status}`;
    statusBadge.innerHTML = `<i class="fas fa-circle"></i> ${statusDisplay}`;
    
    document.getElementById('modal-student-meta').textContent = `ID: ${student.id} · Grade ${student.grade}`;
    
    const widaDate = student.wida_updated || student.updated || 'N/A';
    const mapDate = student.map_updated || student.updated || 'N/A';
    const wrapDate = student.wrap_updated || student.updated || 'N/A';
    
    const widaGrid = document.getElementById('modal-wida-scores');
    if (student.wida) {
        widaGrid.innerHTML = `
            <div class="modal-score-item"><span class="score-label">Speaking</span><span class="score-value">${student.wida.speaking}</span></div>
            <div class="modal-score-item"><span class="score-label">Listening</span><span class="score-value">${student.wida.listening}</span></div>
            <div class="modal-score-item"><span class="score-label">Reading</span><span class="score-value">${student.wida.reading}</span></div>
            <div class="modal-score-item"><span class="score-label">Writing</span><span class="score-value">${student.wida.writing}</span></div>
            <div class="modal-score-item"><span class="score-label">Oral</span><span class="score-value">${student.wida.oral}</span></div>
            <div class="modal-score-item"><span class="score-label">Literacy</span><span class="score-value">${student.wida.literacy}</span></div>
            <div class="modal-score-item" style="font-weight: 600;"><span class="score-label">Composite</span><span class="score-value">${student.wida.composite}</span></div>
            <div class="modal-score-item"><span class="score-label">Date Taken</span><span class="score-value" style="font-size: 0.8rem; color: #5b6f84;">${widaDate}</span></div>
        `;
    } else {
        widaGrid.innerHTML = `<p style="color: #8a9fb3; font-style: italic; grid-column: 1/-1;">No WIDA scores available</p>`;
    }
    
    const mapGrid = document.getElementById('modal-map-scores');
    if (student.map) {
        mapGrid.innerHTML = `
            <div class="modal-score-item"><span class="score-label">Reading</span><span class="score-value">${student.map.reading}</span></div>
            <div class="modal-score-item"><span class="score-label">Mathematics</span><span class="score-value">${student.map.mathematics}</span></div>
            <div class="modal-score-item"><span class="score-label">Language Use</span><span class="score-value">${student.map.language}</span></div>
            <div class="modal-score-item"><span class="score-label">Science</span><span class="score-value">${student.map.science}</span></div>
            <div class="modal-score-item"><span class="score-label">Date Taken</span><span class="score-value" style="font-size: 0.8rem; color: #5b6f84;">${mapDate}</span></div>
        `;
    } else {
        mapGrid.innerHTML = `<p style="color: #8a9fb3; font-style: italic; grid-column: 1/-1;">No MAP scores available</p>`;
    }
    
    const wrapGrid = document.getElementById('modal-wrap-scores');
    if (student.wrap) {
        wrapGrid.innerHTML = `
            <div class="modal-score-item"><span class="score-label">Overall Development</span><span class="score-value">${student.wrap.overall}</span></div>
            <div class="modal-score-item"><span class="score-label">Organization</span><span class="score-value">${student.wrap.organization}</span></div>
            <div class="modal-score-item"><span class="score-label">Support</span><span class="score-value">${student.wrap.support}</span></div>
            <div class="modal-score-item"><span class="score-label">Structure</span><span class="score-value">${student.wrap.structure}</span></div>
            <div class="modal-score-item"><span class="score-label">Word Choice</span><span class="score-value">${student.wrap.wordChoice}</span></div>
            <div class="modal-score-item"><span class="score-label">Mechanics</span><span class="score-value">${student.wrap.mechanics}</span></div>
            <div class="modal-score-item" style="font-weight: 600;"><span class="score-label">Total Raw Score</span><span class="score-value">${student.wrap.totalRaw}</span></div>
            <div class="modal-score-item"><span class="score-label">Date Taken</span><span class="score-value" style="font-size: 0.8rem; color: #5b6f84;">${wrapDate}</span></div>
        `;
    } else {
        wrapGrid.innerHTML = `<p style="color: #8a9fb3; font-style: italic; grid-column: 1/-1;">No WrAP scores available</p>`;
    }
    
    const obsText = document.getElementById('modal-obs-text');
    const obsMeta = document.getElementById('modal-obs-meta');
    if (student.observations) {
        obsText.textContent = student.observations.text;
        obsText.className = 'modal-obs-text';
        obsMeta.textContent = `Last updated: ${student.observations.updated || 'N/A'}`;
    } else {
        obsText.textContent = 'No observations recorded yet.';
        obsText.className = 'modal-obs-text empty';
        obsMeta.textContent = '';
    }
    
    updateStudentStats(student);
}

// ============================================================
// STUDENT PROGRESS CHARTS
// ============================================================

let studentChartInstances = {};

function getStudentHistory(student) {
    const history = [];
    
    async function fetchHistory() {
        try {
            const { data: widaHistory } = await sb
                .from('wida_history')
                .select('*')
                .eq('student_id', student.id)
                .order('date_taken', { ascending: true });
            
            const { data: mapHistory } = await sb
                .from('map_history')
                .select('*')
                .eq('student_id', student.id)
                .order('date_taken', { ascending: true });
            
            const { data: wrapHistory } = await sb
                .from('wrap_history')
                .select('*')
                .eq('student_id', student.id)
                .order('date_taken', { ascending: true });
            
            if (widaHistory) {
                widaHistory.forEach(record => {
                    history.push({
                        year: record.date_taken || 'Unknown',
                        testType: 'WIDA',
                        wida: {
                            speaking: parseFloat(record.speaking) || 0,
                            listening: parseFloat(record.listening) || 0,
                            reading: parseFloat(record.reading) || 0,
                            writing: parseFloat(record.writing) || 0,
                            composite: parseFloat(record.composite) || 0,
                            oral: parseFloat(record.oral) || 0,
                            literacy: parseFloat(record.literacy) || 0
                        },
                        map: null,
                        wrap: null,
                        lexile: record.lexile || 'N/A'
                    });
                });
            }
            
            if (mapHistory) {
                mapHistory.forEach(record => {
                    history.push({
                        year: record.date_taken || 'Unknown',
                        testType: 'MAP',
                        wida: null,
                        map: {
                            reading: parseInt(record.reading) || 0,
                            mathematics: parseInt(record.mathematics) || 0,
                            language: parseInt(record.language) || 0,
                            science: parseInt(record.science) || 0
                        },
                        wrap: null,
                        lexile: record.lexile || 'N/A'
                    });
                });
            }
            
            if (wrapHistory) {
                wrapHistory.forEach(record => {
                    history.push({
                        year: record.date_taken || 'Unknown',
                        testType: 'WrAP',
                        wida: null,
                        map: null,
                        wrap: {
                            overall: parseInt(record.overall) || 0,
                            organization: parseInt(record.organization) || 0,
                            support: parseInt(record.support) || 0,
                            structure: parseInt(record.structure) || 0,
                            wordChoice: parseInt(record.wordchoice) || 0,
                            mechanics: parseInt(record.mechanics) || 0,
                            totalRaw: parseInt(record.totalraw) || 0
                        },
                        lexile: record.lexile || 'N/A'
                    });
                });
            }
            
            if (student.wida) {
                history.push({
                    year: student.wida_updated || student.updated || 'Current',
                    testType: 'WIDA',
                    wida: {
                        speaking: student.wida.speaking || 0,
                        listening: student.wida.listening || 0,
                        reading: student.wida.reading || 0,
                        writing: student.wida.writing || 0,
                        composite: student.wida.composite || 0,
                        oral: student.wida.oral || 0,
                        literacy: student.wida.literacy || 0
                    },
                    map: null,
                    wrap: null,
                    lexile: student.lexile || 'N/A'
                });
            }
            
            if (student.map) {
                history.push({
                    year: student.map_updated || student.updated || 'Current',
                    testType: 'MAP',
                    wida: null,
                    map: {
                        reading: student.map.reading || 0,
                        mathematics: student.map.mathematics || 0,
                        language: student.map.language || 0,
                        science: student.map.science || 0
                    },
                    wrap: null,
                    lexile: student.lexile || 'N/A'
                });
            }
            
            if (student.wrap) {
                history.push({
                    year: student.wrap_updated || student.updated || 'Current',
                    testType: 'WrAP',
                    wida: null,
                    map: null,
                    wrap: {
                        overall: student.wrap.overall || 0,
                        organization: student.wrap.organization || 0,
                        support: student.wrap.support || 0,
                        structure: student.wrap.structure || 0,
                        wordChoice: student.wrap.wordChoice || 0,
                        mechanics: student.wrap.mechanics || 0,
                        totalRaw: student.wrap.totalRaw || 0
                    },
                    lexile: student.lexile || 'N/A'
                });
            }
            
        } catch (error) {
            console.error('Error fetching history:', error);
        }
        
        history.sort((a, b) => {
            const dateA = new Date(a.year);
            const dateB = new Date(b.year);
            return dateA - dateB;
        });
        
        return history;
    }
    
    return fetchHistory();
}

function calculateStudentRank(student) {
    const sameGrade = studentData.filter(s => s.grade === student.grade && s.wida !== null);
    const studentComposite = student.wida ? student.wida.composite : 0;
    
    const sorted = [...sameGrade].sort((a, b) => (b.wida?.composite || 0) - (a.wida?.composite || 0));
    const rank = sorted.findIndex(s => s.id === student.id) + 1;
    
    return {
        rank: rank || 'N/A',
        total: sameGrade.length || 0,
        percentile: sameGrade.length > 0 && rank > 0 ? ((1 - (rank / sameGrade.length)) * 100).toFixed(0) : 'N/A'
    };
}

function createStudentWIDAChart(student, history) {
    const ctx = document.getElementById('modal-chart-wida');
    if (!ctx) return;
    
    if (studentChartInstances['wida']) {
        studentChartInstances['wida'].destroy();
        delete studentChartInstances['wida'];
    }
    
    const validHistory = history.filter(h => h.wida !== null);
    
    if (validHistory.length === 0) {
        const parent = ctx.parentElement;
        parent.innerHTML = '<p style="text-align: center; color: #8a9fb3; padding: 2rem;">No WIDA data available</p>';
        return;
    }
    
    const labels = validHistory.map(h => h.year);
    const colors = ['#b91c1c', '#b9770e', '#0d7c4a', '#1a8a4a', '#6f42c1', '#dc3545', '#fd7e14'];
    const domains = ['composite', 'speaking', 'listening', 'reading', 'writing', 'oral', 'literacy'];
    const domainLabels = ['Composite', 'Speaking', 'Listening', 'Reading', 'Writing', 'Oral', 'Literacy'];
    
    const datasets = domains.map((domain, index) => {
        const data = validHistory.map(h => h.wida ? h.wida[domain] || 0 : 0);
        return {
            label: domainLabels[index],
            data: data,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '33',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: colors[index % colors.length],
            borderWidth: 2
        };
    });
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 9 },
                        boxWidth: 12,
                        boxHeight: 12,
                        useBorderRadius: true,
                        borderRadius: 3
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 6,
                    ticks: { font: { size: 9 } },
                    title: {
                        display: true,
                        text: 'Score',
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: { font: { size: 9 } }
                }
            }
        }
    });
    
    studentChartInstances['wida'] = chart;
}

function createStudentMAPChart(student, history) {
    const ctx = document.getElementById('modal-chart-map');
    if (!ctx) return;
    
    if (studentChartInstances['map']) {
        studentChartInstances['map'].destroy();
        delete studentChartInstances['map'];
    }
    
    const validHistory = history.filter(h => h.map !== null);
    
    if (validHistory.length === 0) {
        const parent = ctx.parentElement;
        parent.innerHTML = '<p style="text-align: center; color: #8a9fb3; padding: 2rem;">No MAP data available</p>';
        return;
    }
    
    const labels = validHistory.map(h => h.year);
    const colors = ['#b91c1c', '#b9770e', '#0d7c4a', '#1a8a4a'];
    const domains = ['reading', 'mathematics', 'language', 'science'];
    const domainLabels = ['Reading', 'Mathematics', 'Language Use', 'Science'];
    
    const datasets = domains.map((domain, index) => {
        const data = validHistory.map(h => h.map ? h.map[domain] || 0 : 0);
        return {
            label: domainLabels[index],
            data: data,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '33',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: colors[index % colors.length],
            borderWidth: 2
        };
    });
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 9 },
                        boxWidth: 12,
                        boxHeight: 12,
                        useBorderRadius: true,
                        borderRadius: 3
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { font: { size: 9 } },
                    title: {
                        display: true,
                        text: 'Score',
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: { font: { size: 9 } }
                }
            }
        }
    });
    
    studentChartInstances['map'] = chart;
}

function createStudentWRAPChart(student, history) {
    const ctx = document.getElementById('modal-chart-wrap');
    if (!ctx) return;
    
    if (studentChartInstances['wrap']) {
        studentChartInstances['wrap'].destroy();
        delete studentChartInstances['wrap'];
    }
    
    const validHistory = history.filter(h => h.wrap !== null);
    
    if (validHistory.length === 0) {
        const parent = ctx.parentElement;
        parent.innerHTML = '<p style="text-align: center; color: #8a9fb3; padding: 2rem;">No WrAP data available</p>';
        return;
    }
    
    const labels = validHistory.map(h => h.year);
    const colors = ['#b91c1c', '#b9770e', '#0d7c4a', '#1a8a4a', '#6f42c1', '#dc3545'];
    const domains = ['overall', 'organization', 'support', 'structure', 'wordChoice', 'mechanics'];
    const domainLabels = ['Overall', 'Organization', 'Support', 'Structure', 'Word Choice', 'Mechanics'];
    
    const datasets = domains.map((domain, index) => {
        const data = validHistory.map(h => h.wrap ? h.wrap[domain] || 0 : 0);
        return {
            label: domainLabels[index],
            data: data,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '33',
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: colors[index % colors.length],
            borderWidth: 2
        };
    });
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 9 },
                        boxWidth: 12,
                        boxHeight: 12,
                        useBorderRadius: true,
                        borderRadius: 3
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 6,
                    ticks: { font: { size: 9 } },
                    title: {
                        display: true,
                        text: 'Score',
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: { font: { size: 9 } }
                }
            }
        }
    });
    
    studentChartInstances['wrap'] = chart;
}

function createStudentLexileChart(student, history) {
    const ctx = document.getElementById('modal-chart-lexile');
    if (!ctx) return;
    
    if (studentChartInstances['lexile']) {
        studentChartInstances['lexile'].destroy();
        delete studentChartInstances['lexile'];
    }
    
    const labels = history.map(h => h.year);
    const lexileValues = history.map(h => {
        const val = parseInt(h.lexile);
        return isNaN(val) ? 0 : val;
    });
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Lexile Level',
                data: lexileValues,
                borderColor: '#4b6a8b',
                backgroundColor: '#4b6a8b33',
                fill: true,
                tension: 0.3,
                pointRadius: 5,
                pointBackgroundColor: '#4b6a8b',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 10 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return 'Lexile: ' + context.parsed.y + 'L';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { 
                        font: { size: 9 },
                        callback: function(value) {
                            return value + 'L';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Lexile Level',
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: { font: { size: 9 } }
                }
            }
        }
    });
    
    studentChartInstances['lexile'] = chart;
}

async function updateStudentStats(student) {
    if (!student) {
        const rankEl = document.getElementById('modal-rank');
        const percentileEl = document.getElementById('modal-percentile');
        const totalTestsEl = document.getElementById('modal-total-tests');
        const growthEl = document.getElementById('modal-growth');
        
        if (rankEl) rankEl.textContent = 'N/A';
        if (percentileEl) percentileEl.textContent = 'N/A';
        if (totalTestsEl) totalTestsEl.textContent = '0/3';
        if (growthEl) growthEl.textContent = 'N/A';
        
        const chartContainers = document.querySelectorAll('#modal-tab-stats .chart-container');
        chartContainers.forEach(container => {
            if (container) {
                container.innerHTML = '<p style="text-align: center; color: #8a9fb3; padding: 2rem;">No test data available for this student</p>';
            }
        });
        return;
    }
    
    const history = await getStudentHistory(student);
    
    if (history.length === 0) {
        document.getElementById('modal-rank').textContent = 'N/A';
        document.getElementById('modal-percentile').textContent = 'N/A';
        document.getElementById('modal-total-tests').textContent = '0/3';
        document.getElementById('modal-growth').textContent = 'N/A';
        return;
    }
    
    const rankData = calculateStudentRank(student);
    document.getElementById('modal-rank').textContent = rankData.rank !== 'N/A' ? `#${rankData.rank} of ${rankData.total}` : 'N/A';
    document.getElementById('modal-percentile').textContent = rankData.percentile !== 'N/A' ? `${rankData.percentile}%` : 'N/A';
    
    let testsTaken = 0;
    if (student.wida) testsTaken++;
    if (student.map) testsTaken++;
    if (student.wrap) testsTaken++;
    document.getElementById('modal-total-tests').textContent = testsTaken + '/3';
    
    const widaHistory = history.filter(h => h.wida !== null);
    if (widaHistory.length >= 2) {
        const first = widaHistory[0]?.wida?.composite || 0;
        const last = widaHistory[widaHistory.length - 1]?.wida?.composite || 0;
        const growth = last - first;
        document.getElementById('modal-growth').textContent = (growth > 0 ? '+' : '') + growth.toFixed(2);
    } else {
        document.getElementById('modal-growth').textContent = 'N/A';
    }
    
    createStudentWIDAChart(student, history);
    createStudentMAPChart(student, history);
    createStudentWRAPChart(student, history);
    createStudentLexileChart(student, history);
}

// ============================================================
// IMPORT STUDENTS
// ============================================================

let importedData = [];
let csvHeaders = [];

document.getElementById('import-students-btn')?.addEventListener('click', function() {
    document.getElementById('import-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    resetImportModal();
});

document.getElementById('close-import-modal')?.addEventListener('click', closeImportModal);
document.getElementById('cancel-import')?.addEventListener('click', closeImportModal);

document.getElementById('import-modal')?.addEventListener('click', function(e) {
    if (e.target === this) {
        closeImportModal();
    }
});

function closeImportModal() {
    document.getElementById('import-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    resetImportModal();
}

function resetImportModal() {
    document.getElementById('file-input').value = '';
    document.getElementById('file-name-display').style.display = 'none';
    document.getElementById('mapping-section').style.display = 'none';
    document.getElementById('preview-section').style.display = 'none';
    document.getElementById('confirm-import-btn').style.display = 'none';
    document.getElementById('import-progress').style.display = 'none';
    importedData = [];
    csvHeaders = [];
}

document.getElementById('browse-file-btn')?.addEventListener('click', function() {
    document.getElementById('file-input').click();
});

document.getElementById('file-input')?.addEventListener('change', function(e) {
    if (this.files.length > 0) {
        handleFile(this.files[0]);
    }
});

const dropZone = document.getElementById('file-drop-zone');
dropZone?.addEventListener('dragover', function(e) {
    e.preventDefault();
    this.classList.add('dragover');
});

dropZone?.addEventListener('dragleave', function(e) {
    e.preventDefault();
    this.classList.remove('dragover');
});

dropZone?.addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
        alert('Please upload a CSV file.');
        return;
    }
    
    document.getElementById('selected-file-name').textContent = file.name;
    document.getElementById('file-name-display').style.display = 'block';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        parseCSV(text);
    };
    reader.readAsText(file);
}

function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim() !== '');
    if (lines.length < 2) {
        alert('CSV file must contain headers and at least one row of data.');
        return;
    }
    
    const headers = lines[0].split(',').map(h => h.trim());
    csvHeaders = headers;
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }
    
    importedData = data;
    showMappingStep(headers);
}

function showMappingStep(headers) {
    const mappingSection = document.getElementById('mapping-section');
    mappingSection.style.display = 'block';
    
    const container = document.getElementById('column-mapping');
    
    const fields = [
        { key: 'id', label: 'Student ID *', required: true },
        { key: 'lastname', label: 'Last Name', required: false },
        { key: 'firstname', label: 'First Name', required: false },
        { key: 'grade', label: 'Grade *', required: true },
        { key: 'school', label: 'School', required: false },
        { key: 'email', label: 'Email', required: false },
        { key: 'teacher', label: 'EAL Teacher', required: false },
        { key: 'lexile', label: 'Lexile', required: false },
        { key: 'enrollment_month', label: 'Enrollment Month', required: false },
        { key: 'enrollment_year', label: 'Enrollment Year', required: false },
        { key: 'leave_date', label: 'Leave Date', required: false },
        { key: 'wida_updated', label: 'WIDA Date', required: false },
        { key: 'map_updated', label: 'MAP Date', required: false },
        { key: 'wrap_updated', label: 'WrAP Date', required: false },
        { key: 'wida_composite', label: 'WIDA Overall', required: false },
        { key: 'wida_speaking', label: 'WIDA Speaking', required: false },
        { key: 'wida_listening', label: 'WIDA Listening', required: false },
        { key: 'wida_reading', label: 'WIDA Reading', required: false },
        { key: 'wida_writing', label: 'WIDA Writing', required: false },
        { key: 'wida_oral', label: 'WIDA Oral', required: false },
        { key: 'wida_literacy', label: 'WIDA Literacy', required: false },
        { key: 'map_reading', label: 'MAP Reading', required: false },
        { key: 'map_mathematics', label: 'MAP Math', required: false },
        { key: 'map_language', label: 'MAP Language', required: false },
        { key: 'map_science', label: 'MAP Science', required: false },
        { key: 'wrap_overall', label: 'WrAP Overall', required: false },
        { key: 'wrap_organization', label: 'WrAP Organization', required: false },
        { key: 'wrap_support', label: 'WrAP Support', required: false },
        { key: 'wrap_structure', label: 'WrAP Structure', required: false },
        { key: 'wrap_wordChoice', label: 'WrAP Word Choice', required: false },
        { key: 'wrap_mechanics', label: 'WrAP Mechanics', required: false },
        { key: 'wrap_totalraw', label: 'WrAP Total Raw', required: false },
        { key: 'observation_text', label: 'Observation', required: false },
    ];
    
    let html = '';
    fields.forEach(field => {
        html += `
            <div class="mapping-row">
                <label>${field.label} ${field.required ? '<span style="color: #b91c1c;">*</span>' : ''}</label>
                <select data-key="${field.key}" data-required="${field.required}">
                    <option value="">-- Skip --</option>
                    ${headers.map(h => `<option value="${h}">${h}</option>`).join('')}
                </select>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    document.querySelectorAll('#column-mapping select').forEach(select => {
        const key = select.dataset.key;
        const header = headers.find(h => 
            h.toLowerCase().includes(key.toLowerCase()) ||
            key.toLowerCase().includes(h.toLowerCase())
        );
        if (header) {
            select.value = header;
        }
    });
    
    document.getElementById('preview-section').style.display = 'block';
    document.getElementById('confirm-import-btn').style.display = 'inline-flex';
    document.getElementById('import-total-count').textContent = importedData.length;
    document.getElementById('import-count-display').textContent = importedData.length;
    
    showImportPreview();
}

function showImportPreview() {
    const previewData = importedData.slice(0, 10);
    const headers = csvHeaders;
    
    const thead = document.getElementById('preview-header');
    const tbody = document.getElementById('preview-body');
    
    thead.innerHTML = `<tr>${headers.map(h => `<th style="padding: 0.3rem 0.4rem; text-align: left; font-size: 0.75rem; white-space: nowrap;">${h}</th>`).join('')}</tr>`;
    
    tbody.innerHTML = previewData.map(row => {
        return `<tr>${headers.map(h => `<td style="padding: 0.3rem 0.4rem; font-size: 0.75rem;">${row[h] || ''}</td>`).join('')}</tr>`;
    }).join('');
    
    document.getElementById('import-total-count').textContent = importedData.length;
    document.getElementById('import-count-display').textContent = importedData.length;
}

document.getElementById('confirm-import-btn')?.addEventListener('click', async function() {
    const mapping = {};
    document.querySelectorAll('#column-mapping select').forEach(select => {
        const key = select.dataset.key;
        const value = select.value;
        if (value) {
            mapping[key] = value;
        }
    });
    
    const requiredFields = ['id', 'grade'];
    const missing = requiredFields.filter(f => !mapping[f]);
    if (missing.length > 0) {
        alert(`Please map the following required fields: ${missing.join(', ')}`);
        return;
    }
    
    const existingStudents = await loadStudentsFromSupabase();
    const existingIds = new Set(existingStudents.map(s => s.id));
    
    const studentsToImport = [];
    const duplicates = [];
    
    importedData.forEach(row => {
        const student = {};
        Object.keys(mapping).forEach(key => {
            const csvField = mapping[key];
            let value = row[csvField] || '';
            
            if (key === 'grade') {
                value = parseInt(value);
            } else if (key === 'lexile') {
                if (value && !value.includes('L')) {
                    value = value + 'L';
                }
            } else if (key.includes('wida_') || key.includes('wrap_') || key.includes('map_')) {
                const numValue = parseFloat(value);
                if (!isNaN(numValue)) {
                    value = numValue;
                } else {
                    value = null;
                }
            }
            
            student[key] = value || null;
        });
        
        if (existingIds.has(student.id) || studentData.some(s => s.id === student.id)) {
            duplicates.push(student.id);
        } else {
            studentsToImport.push(student);
        }
    });
    
    if (duplicates.length > 0) {
        if (!confirm(`${duplicates.length} student(s) with IDs ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ''} already exist. Skip them and continue?`)) {
            return;
        }
    }
    
    if (studentsToImport.length === 0) {
        alert('No new students to import.');
        return;
    }
    
    if (!confirm(`Import ${studentsToImport.length} new students?`)) {
        return;
    }
    
    const progressDiv = document.getElementById('import-progress');
    progressDiv.style.display = 'block';
    const progressBar = document.getElementById('import-progress-bar');
    const progressText = document.getElementById('import-progress-text');
    
    let imported = 0;
    let failed = 0;
    
    for (let i = 0; i < studentsToImport.length; i++) {
        const data = studentsToImport[i];
        
        const student = {
            id: data.id,
            firstname: data.firstname || '',
            lastname: data.lastname || '',
            grade: data.grade,
            school: data.school || 'DAIS',
            enrollment_month: parseInt(data.enrollment_month) || 8,
            enrollment_year: parseInt(data.enrollment_year) || 2026,
            leave_date: data.leave_date || null,
            email: data.email || '',
            teacher: data.teacher || '',
            lexile: data.lexile || 'N/A',
            wida_updated: data.wida_updated || data.updated || '',
            map_updated: data.map_updated || data.updated || '',
            wrap_updated: data.wrap_updated || data.updated || '',
            wida: null,
            map: null,
            wrap: null,
            observations: data.observation_text ? {
                text: data.observation_text,
            } : null
        };
        
        const widaFields = ['composite', 'speaking', 'listening', 'reading', 'writing', 'oral', 'literacy'];
        const hasWIDA = widaFields.some(f => data['wida_' + f] !== null && data['wida_' + f] !== undefined);
        if (hasWIDA) {
            student.wida = {};
            widaFields.forEach(f => {
                student.wida[f] = data['wida_' + f] || 0;
            });
        }
        
        const mapFields = ['reading', 'mathematics', 'language', 'science'];
        const hasMAP = mapFields.some(f => data['map_' + f] !== null && data['map_' + f] !== undefined);
        if (hasMAP) {
            student.map = {};
            mapFields.forEach(f => {
                student.map[f] = data['map_' + f] || 0;
            });
        }
        
        const wrapFields = ['overall', 'organization', 'support', 'structure', 'wordChoice', 'mechanics', 'totalRaw'];
        const hasWRAP = wrapFields.some(f => data['wrap_' + f] !== null && data['wrap_' + f] !== undefined);
        if (hasWRAP) {
            student.wrap = {};
            wrapFields.forEach(f => {
                student.wrap[f] = data['wrap_' + f] || 0;
            });
        }
        
        const success = await saveStudentToSupabase(student);
        if (success) {
            studentData.push(student);
            imported++;
        } else {
            failed++;
        }
        
        const progress = ((i + 1) / studentsToImport.length) * 100;
        progressBar.style.width = progress + '%';
        progressText.textContent = `${i + 1} of ${studentsToImport.length} imported (${failed} failed)`;
    }
    
    alert(`Import complete!\n\n✅ ${imported} students imported\n❌ ${failed} failed`);
    
    renderAdminTable();
    closeImportModal();
});

// ============================================================
// MODAL EVENT LISTENERS
// ============================================================

function closeStudentModal() {
    const modal = document.getElementById('student-modal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('student-modal');
        if (modal.style.display === 'flex') {
            closeStudentModal();
        }
    }
});

document.getElementById('student-modal')?.addEventListener('click', function(e) {
    if (e.target === this) {
        closeStudentModal();
    }
});

document.getElementById('close-modal')?.addEventListener('click', closeStudentModal);

// Click listeners for data cards
document.addEventListener('click', function(e) {
    const card = e.target.closest('.data-card');
    if (card && card.dataset.studentId) {
        if (e.target.closest('button')) return;
        showStudentModal(card.dataset.studentId);
    }
});

// ============================================================
// TAB SWITCHING
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    // Check if logged in
    if (!isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }
    
    // Update user info in header
    document.getElementById('user-name-display').textContent = getUserName() || getUserEmail();
    const roleDisplay = document.getElementById('user-role-display');
    const role = getUserRole();
    roleDisplay.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    if (role === 'super_admin') {
        roleDisplay.style.background = '#dc3545';
        roleDisplay.style.color = 'white';
    } else if (role === 'admin') {
        roleDisplay.style.background = '#4b6a8b';
        roleDisplay.style.color = 'white';
    } else {
        roleDisplay.style.background = '#0d7c4a';
        roleDisplay.style.color = 'white';
    }
    
    // Logout handler
    document.getElementById('logout-btn')?.addEventListener('click', logoutUser);
    
    // Show/hide UI elements based on role
    updateUIForPermissions();
    
    // Admin tab visibility
    if (!canViewAdminFeatures()) {
        const adminTab = document.getElementById('admin-tab-btn');
        if (adminTab) adminTab.style.display = 'none';
    }
    
    // Load data
    initializeApp();
    
    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = {
        wida: document.getElementById('panel-wida'),
        map: document.getElementById('panel-map'),
        wrap: document.getElementById('panel-wrap'),
        stats: document.getElementById('panel-stats'),
        admin: document.getElementById('panel-admin')
    };

    function switchTab(tabId) {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        Object.values(tabPanels).forEach(panel => panel.classList.remove('active'));
        
        const activeButton = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (activeButton) activeButton.classList.add('active');
        if (tabPanels[tabId]) tabPanels[tabId].classList.add('active');
        
        if (tabId === 'wida') {
            filterAndSortWIDA();
        } else if (tabId === 'map') {
            filterAndSortMAP();
        } else if (tabId === 'wrap') {
            filterAndSortWRAP();
        } else if (tabId === 'admin') {
            renderAdminTable();
            renderAccessHistory();
            if (isSuperAdmin()) {
                renderUserManagement();
            }
        } else if (tabId === 'stats') {
            initializeStats();
        }
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            switchTab(this.getAttribute('data-tab'));
        });
    });

    // ============================================================
    // WIDA EVENT LISTENERS
    // ============================================================
    document.getElementById('wida-reset-filters')?.addEventListener('click', resetWIDAFilters);
    ['wida-grade-filter', 'wida-status-filter', 'wida-sort', 'wida-order'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterAndSortWIDA);
    });

    const widaSearch = document.getElementById('wida-search');
    const widaClearSearch = document.getElementById('wida-clear-search');

    if (widaSearch) {
        widaSearch.addEventListener('input', function() {
            if (widaClearSearch) {
                widaClearSearch.classList.toggle('visible', this.value.length > 0);
            }
            filterAndSortWIDA();
        });
    }

    if (widaClearSearch) {
        widaClearSearch.addEventListener('click', function() {
            if (widaSearch) {
                widaSearch.value = '';
                this.classList.remove('visible');
                filterAndSortWIDA();
                widaSearch.focus();
            }
        });
    }

    // ============================================================
    // MAP EVENT LISTENERS
    // ============================================================
    document.getElementById('map-reset-filters')?.addEventListener('click', resetMAPFilters);
    ['map-grade-filter', 'map-status-filter', 'map-sort', 'map-order', 'map-lexile-min', 'map-lexile-max'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterAndSortMAP);
        document.getElementById(id)?.addEventListener('input', filterAndSortMAP);
    });

    const mapSearch = document.getElementById('map-search');
    const mapClearSearch = document.getElementById('map-clear-search');

    if (mapSearch) {
        mapSearch.addEventListener('input', function() {
            if (mapClearSearch) {
                mapClearSearch.classList.toggle('visible', this.value.length > 0);
            }
            filterAndSortMAP();
        });
    }

    if (mapClearSearch) {
        mapClearSearch.addEventListener('click', function() {
            if (mapSearch) {
                mapSearch.value = '';
                this.classList.remove('visible');
                filterAndSortMAP();
                mapSearch.focus();
            }
        });
    }

    // ============================================================
    // WRAP EVENT LISTENERS
    // ============================================================
    document.getElementById('wrap-reset-filters')?.addEventListener('click', resetWRAPFilters);
    ['wrap-grade-filter', 'wrap-status-filter', 'wrap-sort', 'wrap-order'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterAndSortWRAP);
    });

    const wrapSearch = document.getElementById('wrap-search');
    const wrapClearSearch = document.getElementById('wrap-clear-search');

    if (wrapSearch) {
        wrapSearch.addEventListener('input', function() {
            if (wrapClearSearch) {
                wrapClearSearch.classList.toggle('visible', this.value.length > 0);
            }
            filterAndSortWRAP();
        });
    }

    if (wrapClearSearch) {
        wrapClearSearch.addEventListener('click', function() {
            if (wrapSearch) {
                wrapSearch.value = '';
                this.classList.remove('visible');
                filterAndSortWRAP();
                wrapSearch.focus();
            }
        });
    }

    // ============================================================
    // ADMIN EVENT LISTENERS
    // ============================================================
    document.getElementById('admin-reset-filters')?.addEventListener('click', resetAdminFilters);

    ['admin-grade-filter', 'admin-status-filter', 'admin-enrollment-filter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filterAndSortAdmin);
    });

    document.getElementById('admin-search')?.addEventListener('input', filterAndSortAdmin);

    // History search with debounce
    let historyTimeout;
    document.getElementById('history-search')?.addEventListener('input', function() {
        clearTimeout(historyTimeout);
        historyTimeout = setTimeout(renderAccessHistory, 300);
    });

    document.getElementById('history-refresh-btn')?.addEventListener('click', renderAccessHistory);

    // ============================================================
    // STATS EVENT LISTENERS
    // ============================================================

    document.getElementById('stats-reset-filters')?.addEventListener('click', resetStatsFilters);
    document.getElementById('stats-grade-filter')?.addEventListener('change', updateStats);
    document.getElementById('stats-trend-grade')?.addEventListener('change', updateStats);
    document.getElementById('stats-from-month')?.addEventListener('change', updateStats);
    document.getElementById('stats-from-year')?.addEventListener('change', updateStats);
    document.getElementById('stats-to-month')?.addEventListener('change', updateStats);
    document.getElementById('stats-to-year')?.addEventListener('change', updateStats);

    // ============================================================
    // CHART TYPE TOGGLE
    // ============================================================

    document.getElementById('chart-type-bar')?.addEventListener('click', function() {
        toggleChartType('bar');
    });

    document.getElementById('chart-type-line')?.addEventListener('click', function() {
        toggleChartType('line');
    });

    // ============================================================
    // TREND SECTION TOGGLE
    // ============================================================

    document.getElementById('trend-toggle')?.addEventListener('click', function(e) {
        if (e.target.closest('.filter-group') || e.target.closest('#trend-toggle-btn')) {
            return;
        }
        toggleTrendSection();
    });

    document.getElementById('trend-toggle-btn')?.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleTrendSection();
    });

    // ============================================================
    // ADD STUDENT EVENT LISTENERS
    // ============================================================

    document.getElementById('add-student-btn')?.addEventListener('click', openAddStudentModal);

    document.getElementById('close-add-modal')?.addEventListener('click', closeAddStudentModal);
    document.getElementById('cancel-add-student')?.addEventListener('click', closeAddStudentModal);

    document.getElementById('add-student-modal')?.addEventListener('click', function(e) {
        if (e.target === this) {
            closeAddStudentModal();
        }
    });

    document.getElementById('add-student-form')?.addEventListener('submit', function(e) {
        e.preventDefault();
    
        const editIdField = document.getElementById('edit-student-id');
        const editId = editIdField ? editIdField.value : null;
        
        const formData = {
            id: document.getElementById('add-id').value.trim(),
            firstName: document.getElementById('add-firstname').value.trim(),
            lastName: document.getElementById('add-lastname').value.trim(),
            grade: document.getElementById('add-grade').value,
            school: document.getElementById('add-school').value,
            enrollmentMonth: document.getElementById('add-enrollment-month').value,
            enrollmentYear: document.getElementById('add-enrollment-year').value,
            leaveDate: document.getElementById('add-leave-date').value || null,
            email: document.getElementById('add-email').value.trim(),
            teacher: document.getElementById('add-teacher').value.trim(),
            lexile: document.getElementById('add-lexile').value.trim(),
            widaOverall: document.getElementById('add-wida-overall').value,
            widaSpeaking: document.getElementById('add-wida-speaking').value,
            widaListening: document.getElementById('add-wida-listening').value,
            widaWriting: document.getElementById('add-wida-writing').value,
            widaReading: document.getElementById('add-wida-reading').value,
            widaOral: document.getElementById('add-wida-oral').value,
            widaLiteracy: document.getElementById('add-wida-literacy').value,
            mapReading: document.getElementById('add-map-reading').value,
            mapMath: document.getElementById('add-map-math').value,
            mapLanguage: document.getElementById('add-map-language').value,
            mapScience: document.getElementById('add-map-science').value,
            wrapOverall: document.getElementById('add-wrap-overall').value,
            wrapOrganization: document.getElementById('add-wrap-organization').value,
            wrapSupport: document.getElementById('add-wrap-support').value,
            wrapStructure: document.getElementById('add-wrap-structure').value,
            wrapWordChoice: document.getElementById('add-wrap-wordchoice').value,
            wrapMechanics: document.getElementById('add-wrap-mechanics').value,
            wrapTotalRaw: document.getElementById('add-wrap-totalraw').value,
            observations: document.getElementById('add-observations').value.trim()
        };
        
        if (!formData.firstName || !formData.lastName || !formData.grade) {
            alert('Please fill in all required fields (First Name, Last Name, Grade)');
            return;
        }
        
        if (editId) {
            formData.id = editId;
            updateStudentInData(editId, formData);
        } else {
            if (!formData.id) {
                alert('Please enter a Student ID');
                return;
            }
            if (studentData.some(s => s.id === formData.id)) {
                alert('Student ID ' + formData.id + ' already exists. Please use a unique ID.');
                return;
            }
            addStudentToData(formData);
        }
    });

    // ============================================================
    // MODAL TAB SWITCHING (inside student modal)
    // ============================================================
    
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.modalTab;
            
            document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('active'));
            
            this.classList.add('active');
            document.getElementById('modal-tab-' + tabId).classList.add('active');
        });
    });
});


// ============================================================
// UPDATE UI PERMISSIONS
// ============================================================

function updateUIForPermissions() {
    const canEdit = canEditData();
    const canViewAdmin = canViewAdminFeatures();
    const canManage = canManageUsers();
    
    // Edit buttons
    document.querySelectorAll('.edit-required').forEach(el => {
        el.style.display = canEdit ? 'inline-flex' : 'none';
    });
    
    // Admin features (logs, etc.)
    document.querySelectorAll('.admin-required').forEach(el => {
        el.style.display = canViewAdmin ? 'block' : 'none';
    });
    
    // User management (super admin only)
    document.querySelectorAll('.super-admin-only').forEach(el => {
        el.style.display = canManage ? 'block' : 'none';
    });
    
    // Admin tab - hide for teachers
    if (!canViewAdmin) {
        const adminTab = document.getElementById('admin-tab-btn');
        if (adminTab) adminTab.style.display = 'none';
        
        // If currently on admin tab, switch to WIDA
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab?.dataset.tab === 'admin') {
            document.querySelector('[data-tab="wida"]')?.click();
        }
    }
}

// ============================================================
// ADD STUDENT TO DATA
// ============================================================

async function addStudentToData(formData) {
    const newStudent = {
        id: formData.id,
        firstname: formData.firstName || '',
        lastname: formData.lastName || '',
        grade: parseInt(formData.grade),
        school: formData.school || 'DAIS',
        enrollment_month: parseInt(formData.enrollmentMonth) || 8,
        enrollment_year: parseInt(formData.enrollmentYear) || 2026,
        leave_date: formData.leaveDate || null,
        email: formData.email || '',
        teacher: formData.teacher || '',
        lexile: formData.lexile || 'N/A',
        wida_updated: '',
        map_updated: '',
        wrap_updated: '',
        wida: null,
        map: null,
        wrap: null,
        observations: formData.observations ? {
            text: formData.observations,
        } : null
    };
    
    if (formData.widaOverall) {
        newStudent.wida = {
            listening: parseFloat(formData.widaListening) || 0,
            speaking: parseFloat(formData.widaSpeaking) || 0,
            reading: parseFloat(formData.widaReading) || 0,
            writing: parseFloat(formData.widaWriting) || 0,
            composite: parseFloat(formData.widaOverall) || 0,
            oral: parseFloat(formData.widaOral) || 0,
            literacy: parseFloat(formData.widaLiteracy) || 0
        };
        newStudent.wida_updated = document.getElementById('add-wida-date').value || '';
    }
    
    if (formData.mapReading) {
        newStudent.map = {
            reading: parseInt(formData.mapReading) || 0,
            mathematics: parseInt(formData.mapMath) || 0,
            language: parseInt(formData.mapLanguage) || 0,
            science: parseInt(formData.mapScience) || 0
        };
        newStudent.map_updated = document.getElementById('add-map-date').value || '';
    }
    
    if (formData.wrapOverall) {
        newStudent.wrap = {
            overall: parseFloat(formData.wrapOverall) || 0,
            organization: parseFloat(formData.wrapOrganization) || 0,
            support: parseFloat(formData.wrapSupport) || 0,
            structure: parseFloat(formData.wrapStructure) || 0,
            wordChoice: parseFloat(formData.wrapWordChoice) || 0,
            mechanics: parseFloat(formData.wrapMechanics) || 0,
            totalRaw: parseInt(formData.wrapTotalRaw) || 0
        };
        newStudent.wrap_updated = document.getElementById('add-wrap-date').value || '';
    }
    
    studentData.push(newStudent);
    await saveStudentToSupabase(newStudent);
    renderAdminTable();
    closeAddStudentModal();
    alert('Student ' + (newStudent.firstname + ' ' + newStudent.lastname).trim() + ' added successfully!');
}

// ============================================================
// CONFIRM ADD NEW TEST LOGIC
// ============================================================

let pendingAddTest = {
    studentId: null,
    testType: null
};

function openConfirmAddTest(studentId, testType) {
    const student = studentData.find(s => s.id === studentId);
    if (!student) {
        alert('Student not found!');
        return;
    }
    
    pendingAddTest.studentId = studentId;
    pendingAddTest.testType = testType;
    
    const modal = document.getElementById('confirm-add-test-modal');
    const title = document.getElementById('confirm-test-title');
    const content = document.getElementById('confirm-test-content');
    
    title.innerHTML = `<i class="fas fa-plus-circle" style="color: #0d7c4a;"></i> Add New ${testType} Test`;
    
    let hasExistingData = false;
    let currentDate = '';
    
    if (testType === 'WIDA' && student.wida) {
        hasExistingData = true;
        currentDate = student.wida_updated || 'Unknown date';
    } else if (testType === 'MAP' && student.map) {
        hasExistingData = true;
        currentDate = student.map_updated || 'Unknown date';
    } else if (testType === 'WrAP' && student.wrap) {
        hasExistingData = true;
        currentDate = student.wrap_updated || 'Unknown date';
    }
    
    if (hasExistingData) {
        content.innerHTML = `
            <p><strong>Student:</strong> ${(student.firstname + ' ' + student.lastname).trim() || student.id}</p>
            <p><strong>Current ${testType} data:</strong> Taken on ${currentDate}</p>
            <div style="background: #fcf3e0; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.8rem 0; border-left: 4px solid #b9770e;">
                <i class="fas fa-info-circle" style="color: #b9770e;"></i>
                <span style="font-size: 0.9rem; color: #5b6f84;">
                    The current scores will be <strong>archived</strong> to the student's history.
                    You will then be able to enter new test scores.
                </span>
            </div>
            <p style="font-size: 0.85rem; color: #5b6f84;">
                <i class="fas fa-calendar-alt"></i> You will be asked to enter the date of the new test.
            </p>
        `;
    } else {
        content.innerHTML = `
            <p><strong>Student:</strong> ${(student.firstname + ' ' + student.lastname).trim() || student.id}</p>
            <p style="color: #8a9fb3;"><i class="fas fa-info-circle"></i> This student doesn't have any ${testType} scores yet.</p>
            <div style="background: #e6f4ed; border-radius: 8px; padding: 0.8rem 1rem; margin: 0.8rem 0; border-left: 4px solid #0d7c4a;">
                <i class="fas fa-check-circle" style="color: #0d7c4a;"></i>
                <span style="font-size: 0.9rem; color: #5b6f84;">
                    You can add new ${testType} scores directly.
                </span>
            </div>
            <p style="font-size: 0.85rem; color: #5b6f84;">
                <i class="fas fa-calendar-alt"></i> You will be asked to enter the date of the test.
            </p>
        `;
    }
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeConfirmModal() {
    document.getElementById('confirm-add-test-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
    pendingAddTest.studentId = null;
    pendingAddTest.testType = null;
}

async function archiveTestData(student, testType) {
    try {
        let historyData = {
            student_id: student.id,
            lexile: student.lexile || 'N/A'
        };
        
        let tableName = '';
        
        if (testType === 'WIDA') {
            tableName = 'wida_history';
            historyData.date_taken = student.wida_updated || '';
            historyData.composite = student.wida.composite?.toString() || '';
            historyData.speaking = student.wida.speaking?.toString() || '';
            historyData.listening = student.wida.listening?.toString() || '';
            historyData.reading = student.wida.reading?.toString() || '';
            historyData.writing = student.wida.writing?.toString() || '';
            historyData.oral = student.wida.oral?.toString() || '';
            historyData.literacy = student.wida.literacy?.toString() || '';
        } else if (testType === 'MAP') {
            tableName = 'map_history';
            historyData.date_taken = student.map_updated || '';
            historyData.reading = student.map.reading?.toString() || '';
            historyData.mathematics = student.map.mathematics?.toString() || '';
            historyData.language = student.map.language?.toString() || '';
            historyData.science = student.map.science?.toString() || '';
        } else if (testType === 'WrAP') {
            tableName = 'wrap_history';
            historyData.date_taken = student.wrap_updated || '';
            historyData.overall = student.wrap.overall?.toString() || '';
            historyData.organization = student.wrap.organization?.toString() || '';
            historyData.support = student.wrap.support?.toString() || '';
            historyData.structure = student.wrap.structure?.toString() || '';
            historyData.wordchoice = student.wrap.wordChoice?.toString() || '';
            historyData.mechanics = student.wrap.mechanics?.toString() || '';
            historyData.totalraw = student.wrap.totalRaw?.toString() || '';
        }
        
        const { error } = await sb
            .from(tableName)
            .insert(historyData);
        
        if (error) throw error;
        
        console.log(`${testType} data archived for student ${student.id}`);
        return true;
    } catch (error) {
        console.error(`Error archiving ${testType} data:`, error);
        return false;
    }
}

async function continueAddTest() {
    const { studentId, testType } = pendingAddTest;
    if (!studentId || !testType) return;
    
    closeConfirmModal();
    
    const student = studentData.find(s => s.id === studentId);
    if (!student) {
        alert('Student not found!');
        return;
    }
    
    let hasExistingData = false;
    
    if (testType === 'WIDA' && student.wida) {
        hasExistingData = true;
    } else if (testType === 'MAP' && student.map) {
        hasExistingData = true;
    } else if (testType === 'WrAP' && student.wrap) {
        hasExistingData = true;
    }
    
    if (hasExistingData) {
        const success = await archiveTestData(student, testType);
        if (!success) {
            alert(`Failed to archive ${testType} data. Please try again.`);
            return;
        }
        
        if (testType === 'WIDA') {
            student.wida = null;
            student.wida_updated = '';
            document.getElementById('add-wida-overall').value = '';
            document.getElementById('add-wida-speaking').value = '';
            document.getElementById('add-wida-listening').value = '';
            document.getElementById('add-wida-writing').value = '';
            document.getElementById('add-wida-reading').value = '';
            document.getElementById('add-wida-oral').value = '';
            document.getElementById('add-wida-literacy').value = '';
            document.getElementById('add-wida-date').value = '';
        } else if (testType === 'MAP') {
            student.map = null;
            student.map_updated = '';
            document.getElementById('add-map-reading').value = '';
            document.getElementById('add-map-math').value = '';
            document.getElementById('add-map-language').value = '';
            document.getElementById('add-map-science').value = '';
            document.getElementById('add-map-date').value = '';
        } else if (testType === 'WrAP') {
            student.wrap = null;
            student.wrap_updated = '';
            document.getElementById('add-wrap-overall').value = '';
            document.getElementById('add-wrap-organization').value = '';
            document.getElementById('add-wrap-support').value = '';
            document.getElementById('add-wrap-structure').value = '';
            document.getElementById('add-wrap-wordchoice').value = '';
            document.getElementById('add-wrap-mechanics').value = '';
            document.getElementById('add-wrap-totalraw').value = '';
            document.getElementById('add-wrap-date').value = '';
        }
        
        alert(`✅ ${testType} data archived successfully!\n\nYou can now enter the new test scores below and click "Update Student" to save.`);
    } else {
        if (testType === 'WIDA') {
            document.getElementById('add-wida-overall').value = '';
            document.getElementById('add-wida-speaking').value = '';
            document.getElementById('add-wida-listening').value = '';
            document.getElementById('add-wida-writing').value = '';
            document.getElementById('add-wida-reading').value = '';
            document.getElementById('add-wida-oral').value = '';
            document.getElementById('add-wida-literacy').value = '';
            document.getElementById('add-wida-date').value = '';
        } else if (testType === 'MAP') {
            document.getElementById('add-map-reading').value = '';
            document.getElementById('add-map-math').value = '';
            document.getElementById('add-map-language').value = '';
            document.getElementById('add-map-science').value = '';
            document.getElementById('add-map-date').value = '';
        } else if (testType === 'WrAP') {
            document.getElementById('add-wrap-overall').value = '';
            document.getElementById('add-wrap-organization').value = '';
            document.getElementById('add-wrap-support').value = '';
            document.getElementById('add-wrap-structure').value = '';
            document.getElementById('add-wrap-wordchoice').value = '';
            document.getElementById('add-wrap-mechanics').value = '';
            document.getElementById('add-wrap-totalraw').value = '';
            document.getElementById('add-wrap-date').value = '';
        }
        
        alert(`✅ You can now enter new ${testType} scores below and click "Update Student" to save.`);
    }
}

// Add event listeners for Add Test buttons
document.getElementById('add-wida-test-btn')?.addEventListener('click', function() {
    const editId = document.getElementById('edit-student-id')?.value;
    if (editId) {
        openConfirmAddTest(editId, 'WIDA');
    }
});

document.getElementById('add-map-test-btn')?.addEventListener('click', function() {
    const editId = document.getElementById('edit-student-id')?.value;
    if (editId) {
        openConfirmAddTest(editId, 'MAP');
    }
});

document.getElementById('add-wrap-test-btn')?.addEventListener('click', function() {
    const editId = document.getElementById('edit-student-id')?.value;
    if (editId) {
        openConfirmAddTest(editId, 'WrAP');
    }
});

document.getElementById('close-confirm-modal')?.addEventListener('click', closeConfirmModal);
document.getElementById('cancel-confirm-btn')?.addEventListener('click', closeConfirmModal);

document.getElementById('confirm-add-test-modal')?.addEventListener('click', function(e) {
    if (e.target === this) {
        closeConfirmModal();
    }
});

document.getElementById('confirm-continue-btn')?.addEventListener('click', continueAddTest);

// ============================================================
// GET ADMIN PASSWORD (Legacy - kept for compatibility)
// ============================================================

async function getAdminPassword() {
    try {
        const { data, error } = await sb
            .from('admin_settings')
            .select('password')
            .eq('id', 1)
            .single();
        
        if (error) throw error;
        
        return data?.password || 'admin123';
    } catch (error) {
        console.error('Error getting admin password from Supabase:', error);
        return 'admin123';
    }
}

// ============================================================
// INITIALIZE APP
// ============================================================

async function initializeApp() {
    await loadAndSyncFromSupabase();
    filterAndSortWIDA();
    console.log('DAIS/DHS EAL Data Consolidation - Tab system initialized with Supabase');
}