// Authentication and navigation utilities

let currentUser = null;

async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        if (!response.ok) {
            // Already redirected by server, but ensure we're on login page
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
            return null;
        }
        const user = await response.json();
        currentUser = user;
        updateNavbar(user);
        // Show content after auth is confirmed
        document.body.classList.add('authenticated');
        return user;
    } catch (error) {
        if (window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
        return null;
    }
}

function getUser() {
    return currentUser;
}

// Expose globally for quotes.js
window.getUser = getUser;

function updateNavbar(user) {
    const userDisplay = document.getElementById('userDisplay');
    const adminLink = document.getElementById('adminLink');
    
    if (userDisplay) {
        userDisplay.textContent = user.displayName || user.username;
    }
    
    if (adminLink && user.isAdmin) {
        adminLink.innerHTML = '<a href="/admin" class="nav-link">Admin</a>';
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    } catch (error) {
        window.location.href = '/login';
    }
}

// Check auth on page load
if (window.location.pathname === '/login') {
    // On login page, check if already authenticated and redirect
    fetch('/api/me').then(response => {
        if (response.ok) {
            window.location.href = '/';
        } else {
            // Show login page if not authenticated
            document.body.classList.add('authenticated');
        }
    }).catch(() => {
        document.body.classList.add('authenticated');
    });
} else {
    // On protected pages, check auth and hide content until confirmed
    checkAuth();
}
