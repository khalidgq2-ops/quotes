// Quotes page functionality

let users = [];
let groups = [];
let everyoneGroupId = null;
let showGroupUI = true;

// Get user from auth.js (will be set after checkAuth)
function getUser() {
    if (typeof window.getUser === 'function') {
        return window.getUser();
    }
    return null;
}

async function loadGroups() {
    try {
        const r = await fetch('/api/groups');
        groups = await r.json();
        const sel = document.getElementById('groupSelect');
        if (!sel) return;
        
        // Find "Everyone" group ID
        const everyoneGroup = (groups || []).find(g => g.name === 'Everyone');
        everyoneGroupId = everyoneGroup ? everyoneGroup.id : null;
        
        // Check if we should show group UI
        const user = getUser();
        showGroupUI = user && user.showGroupUI !== false;
        
        if (showGroupUI) {
            sel.innerHTML = '<option value="">Select group...</option>';
            (groups || []).forEach(g => {
                const o = document.createElement('option');
                o.value = g.id;
                o.textContent = g.name;
                sel.appendChild(o);
            });
            sel.closest('.form-group').style.display = '';
        } else {
            // Hide group selector, auto-select Everyone
            sel.closest('.form-group').style.display = 'none';
            if (everyoneGroupId) {
                sel.value = everyoneGroupId;
            }
        }
    } catch (e) {
        console.error('Error loading groups:', e);
    }
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        users = await response.json();
        
        const personSelect = document.getElementById('personSelect');
        if (personSelect) {
            personSelect.innerHTML = '<option value="">Select person...</option>';
            (users || []).forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.display_name;
                personSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function loadQuotes() {
    const sortSelect = document.getElementById('sortSelect');
    const sort = sortSelect ? sortSelect.value : 'date_desc';
    
    try {
        const response = await fetch(`/api/quotes?sort=${sort}`);
        const quotes = await response.json();
        
        const quotesList = document.getElementById('quotesList');
        
        if (quotes.length === 0) {
            quotesList.innerHTML = '<p>No quotes yet. Add the first one!</p>';
            return;
        }
        
        let html = '';
        (quotes || []).forEach(quote => {
            // Only show group label if showGroupUI is true
            const groupLabel = (showGroupUI && quote.group_name) ? ` · ${escapeHtml(quote.group_name)}` : '';
            html += `
                <div class="quote-card">
                    <div class="quote-text">"${escapeHtml(quote.quote_text)}"</div>
                    <div class="quote-meta">
                        <span class="quote-person">— ${escapeHtml(quote.person_name)}</span>
                        <span class="quote-date">${formatDate(quote.created_at)}</span>
                        <span class="quote-added-by">Added by ${escapeHtml(quote.added_by_name)}${groupLabel}</span>
                    </div>
                </div>
            `;
        });
        quotesList.innerHTML = html;
    } catch (error) {
        document.getElementById('quotesList').innerHTML = '<p class="error">Error loading quotes.</p>';
    }
}

function showAddQuoteForm() {
    const modal = document.getElementById('addQuoteModal');
    if (modal) {
        modal.style.display = 'block';
        loadGroups();
        loadUsers();
    }
}

function closeAddQuoteForm() {
    const modal = document.getElementById('addQuoteModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('addQuoteForm').reset();
    }
}

document.getElementById('addQuoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const quoteText = document.getElementById('quoteText').value.trim();
    const personId = document.getElementById('personSelect').value;
    // If group UI is hidden, use Everyone group ID
    const groupId = showGroupUI ? document.getElementById('groupSelect').value : everyoneGroupId;
    
    if (!quoteText || !personId || !groupId) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        const response = await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteText, personId: parseInt(personId, 10), groupId: parseInt(groupId, 10) })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            closeAddQuoteForm();
            loadQuotes();
        } else {
            alert(data.error || 'Error adding quote');
        }
    } catch (error) {
        alert('Network error. Please try again.');
    }
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('addQuoteModal');
    if (event.target === modal) {
        closeAddQuoteForm();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Load quotes on page load
// Wait for auth to complete before loading groups
checkAuth().then(() => {
    loadQuotes();
    loadUsers();
    loadGroups();
});
