// Authentication and navigation utilities

async function checkAuth() {
    try {
        const response = await fetch('/api/me');
        if (!response.ok) {
            window.location.href = '/login';
            return null;
        }
        const user = await response.json();
        updateNavbar(user);
        return user;
    } catch (error) {
        window.location.href = '/login';
        return null;
    }
}

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

// Check auth on page load (except login page)
if (!window.location.pathname.includes('login') && window.location.pathname !== '/login') {
    checkAuth();
}
