// Quotes page functionality

let users = [];

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        users = await response.json();
        
        const personSelect = document.getElementById('personSelect');
        if (personSelect) {
            personSelect.innerHTML = '<option value="">Select person...</option>';
            users.forEach(user => {
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
        quotes.forEach(quote => {
            html += `
                <div class="quote-card">
                    <div class="quote-text">"${escapeHtml(quote.quote_text)}"</div>
                    <div class="quote-meta">
                        <span class="quote-person">— ${escapeHtml(quote.person_name)}</span>
                        <span class="quote-date">${formatDate(quote.created_at)}</span>
                        <span class="quote-added-by">Added by ${escapeHtml(quote.added_by_name)}</span>
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
    
    const quoteText = document.getElementById('quoteText').value;
    const personId = document.getElementById('personSelect').value;
    
    if (!quoteText || !personId) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        const response = await fetch('/api/quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteText, personId: parseInt(personId) })
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
loadQuotes();
loadUsers();
