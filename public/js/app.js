// app.js - shared helpers: auth check, nav rendering, logout
async function requireLogin() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) { window.location.href = '/login.html'; return null; }
    const data = await res.json();
    return data.user;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

function renderNav(activePage, user) {
  const isAdmin = user.role === 'admin';
  const links = [
    { href: '/dashboard.html', label: 'Home', key: 'dashboard' },
    { href: '/roster.html', label: 'Roster', key: 'roster' },
    { href: '/talks.html', label: 'Talks', key: 'talks' },
    { href: '/availability.html', label: 'My Availability & Preferences', key: 'availability' },
  ];
  if (isAdmin) links.push({ href: '/schedule-builder.html', label: 'Schedule Builder', key: 'schedule-builder' });
  if (isAdmin) links.push({ href: '/admin.html', label: 'Admin', key: 'admin' });

  const navHtml = `
    <div class="top-nav">
      <div class="brand"><span class="crest"></span> riverwood ecclesia</div>
      <nav>
        ${links.map(l => `<a href="${l.href}" class="${l.key === activePage ? 'active' : ''}">${l.label}</a>`).join('')}
      </nav>
      <div class="user-chip">
        <span>${user.name}${isAdmin ? '<span class="admin-only-tag">Admin</span>' : ''}</span>
        <button id="logoutBtn">Log out</button>
      </div>
    </div>`;
  document.getElementById('nav-root').outerHTML = navHtml;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
  });
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${m}${ampm}`;
}
