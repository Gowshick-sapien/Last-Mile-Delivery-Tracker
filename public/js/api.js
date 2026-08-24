const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('delivery_token');
}

function setToken(token) {
  localStorage.setItem('delivery_token', token);
}

function getUser() {
  const userJson = localStorage.getItem('delivery_user');
  return userJson ? JSON.parse(userJson) : null;
}

function setUser(user) {
  localStorage.setItem('delivery_user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('delivery_token');
  localStorage.removeItem('delivery_user');
  window.location.href = '/index.html';
}

async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({ success: false, message: 'Invalid JSON response' }));

  if (response.status === 401) {
    // If not on login page, redirect
    if (!window.location.pathname.endsWith('index.html') && !window.location.pathname.endsWith('/')) {
      logout();
    }
  }

  if (!response.ok) {
    const error = new Error(data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function showAlert(containerId, message, type = 'info') {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="alert alert-${type}">
      ${message}
    </div>
  `;
  container.classList.remove('hidden');

  setTimeout(() => {
    container.classList.add('hidden');
    container.innerHTML = '';
  }, 5000);
}

function formatCurrency(amount) {
  return `INR ${parseFloat(amount || 0).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderStatusBadge(status) {
  const clean = (status || '').toLowerCase();
  const label = (status || '').replace(/_/g, ' ');
  return `<span class="badge badge-${clean}">${label}</span>`;
}

function setupNavbar(activePage) {
  const user = getUser();
  const navContainer = document.getElementById('navbar-container');
  if (!navContainer) return;

  let links = `
    <a href="/track.html" class="nav-link ${activePage === 'track' ? 'active' : ''}">Track Shipment</a>
  `;

  if (user) {
    if (user.role === 'CUSTOMER') {
      links += `<a href="/customer.html" class="nav-link ${activePage === 'customer' ? 'active' : ''}">Dashboard</a>`;
    } else if (user.role === 'AGENT') {
      links += `<a href="/agent.html" class="nav-link ${activePage === 'agent' ? 'active' : ''}">Agent Portal</a>`;
    } else if (user.role === 'ADMIN') {
      links += `<a href="/admin.html" class="nav-link ${activePage === 'admin' ? 'active' : ''}">Admin Control</a>`;
    }

    links += `
      <span class="user-badge">${user.role}: ${user.name.split(' ')[0]}</span>
      <button onclick="logout()" class="btn btn-secondary btn-sm" style="color:#ffffff;background:transparent;border-color:#475569;">Logout</button>
    `;
  } else {
    links += `<a href="/index.html" class="btn btn-primary btn-sm">Login / Register</a>`;
  }

  navContainer.innerHTML = `
    <nav class="navbar">
      <a href="/index.html" class="nav-brand">Last-Mile Tracker</a>
      <div class="nav-links">${links}</div>
    </nav>
  `;
}
