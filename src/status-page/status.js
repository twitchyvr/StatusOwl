/**
 * StatusOwl — Status Page JavaScript
 * Fetches status data from API and renders the page
 * Features: Dark mode, service groups, uptime history, incident badges, auto-refresh
 */

// Configuration
const API_STATUS_URL = '/api/status';
const API_INCIDENTS_URL = '/api/incidents';
const REFRESH_INTERVAL = 60000; // 60 seconds

// State
let statusData = null;
let incidentsData = null;
let countdownInterval = null;
let secondsUntilRefresh = REFRESH_INTERVAL / 1000;

// Theme Management
const THEME_KEY = 'statusowl-theme';

/**
 * Get the current theme preference
 */
function getThemePreference() {
  // Check localStorage first
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) {
    return savedTheme;
  }
  // Fall back to system preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Apply the theme to the document
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
}

/**
 * Initialize theme based on preference
 */
function initTheme() {
  const theme = getThemePreference();
  applyTheme(theme);
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only auto-switch if user hasn't set a manual preference
    if (!localStorage.getItem(THEME_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

// Auto-refresh Timer
/**
 * Start the countdown timer for auto-refresh
 */
function startRefreshTimer() {
  // Clear any existing timer
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  
  secondsUntilRefresh = REFRESH_INTERVAL / 1000;
  updateRefreshTimerDisplay();
  
  countdownInterval = setInterval(() => {
    secondsUntilRefresh--;
    updateRefreshTimerDisplay();
    
    if (secondsUntilRefresh <= 0) {
      secondsUntilRefresh = REFRESH_INTERVAL / 1000;
    }
  }, 1000);
}

/**
 * Update the refresh timer display
 */
function updateRefreshTimerDisplay() {
  const timerDot = document.querySelector('.refresh-timer-dot');
  const timerText = document.querySelector('.refresh-timer-text');
  
  if (timerDot && timerText) {
    timerText.textContent = `Refreshing in ${secondsUntilRefresh}s`;
    
    // Add active class when timer is running
    if (secondsUntilRefresh > 0) {
      timerDot.classList.add('active');
    } else {
      timerDot.classList.remove('active');
    }
  }
}

/**
 * Get the color class for a status
 */
function getStatusColor(status) {
  switch (status) {
    case 'operational':
      return 'operational';
    case 'degraded':
      return 'degraded';
    case 'major_outage':
    case 'outage':
      return 'outage';
    default:
      return 'unknown';
  }
}

/**
 * Get the human-readable label for a status
 */
function getStatusLabel(status) {
  switch (status) {
    case 'operational':
      return 'Operational';
    case 'degraded':
      return 'Degraded';
    case 'major_outage':
      return 'Major Outage';
    case 'outage':
      return 'Outage';
    default:
      return 'Unknown';
  }
}

/**
 * Get the overall status label
 */
function getOverallStatusLabel(status) {
  switch (status) {
    case 'operational':
      return 'All Systems Operational';
    case 'degraded':
      return 'Some Systems Degraded';
    case 'major_outage':
      return 'Major Outage';
    default:
      return 'Status Unknown';
  }
}

/**
 * Format a date string for display
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Render the overall status banner
 */
function renderOverallStatus(overallStatus) {
  const dot = document.getElementById('overall-dot');
  const text = document.getElementById('overall-text');
  
  const colorClass = getStatusColor(overallStatus);
  
  dot.className = `status-dot ${colorClass}`;
  text.className = `status-text ${colorClass}`;
  text.textContent = getOverallStatusLabel(overallStatus);
}

/**
 * Fetch service uptime data from the API
 */
async function fetchServiceUptimeData(serviceId) {
  try {
    const response = await fetch(`/api/services/${serviceId}/uptime?period=90d`);
    const data = await response.json();
    if (data.ok && data.data) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch uptime for service ${serviceId}:`, error);
    return null;
  }
}

/**
 * Render the uptime history bar
 */
function renderUptimeBar(history) {
  if (!history || !Array.isArray(history)) {
    // No history data - render empty bar with no-data cells
    return `
      <div class="uptime-bar">
        ${Array(90).fill('<div class="uptime-cell no-data"></div>').join('')}
      </div>
    `;
  }
  
  // Ensure we have exactly 90 cells
  const cells = [];
  for (let i = 0; i < 90; i++) {
    const dayData = history[i];
    let cellClass = 'no-data';
    
    if (dayData) {
      switch (dayData.status) {
        case 'operational':
          cellClass = 'operational';
          break;
        case 'degraded':
          cellClass = 'degraded';
          break;
        case 'outage':
        case 'major_outage':
          cellClass = 'outage';
          break;
        default:
          cellClass = 'no-data';
      }
    }
    
    cells.push(`<div class="uptime-cell ${cellClass}" title="${dayData ? dayData.status : 'No data'}"></div>`);
  }
  
  return `<div class="uptime-bar">${cells.join('')}</div>`;
}

/**
 * Group services by their groupId
 */
function groupServices(services) {
  const groups = {};
  const ungrouped = [];
  
  services.forEach(service => {
    if (service.groupId) {
      if (!groups[service.groupId]) {
        groups[service.groupId] = [];
      }
      groups[service.groupId].push(service);
    } else {
      ungrouped.push(service);
    }
  });
  
  return { groups, ungrouped };
}

/**
 * Render a single service item
 */
function renderServiceItem(service) {
  const colorClass = getStatusColor(service.status);
  const uptimeDisplay = service.uptimePercent != null
    ? `${service.uptimePercent.toFixed(2)}%`
    : 'N/A';
  
  const uptimeBarHtml = renderUptimeBar(service.uptimeHistory);
  
  return `
    <div class="service-item">
      <div class="service-info">
        <span class="service-name">${escapeHtml(service.name)}</span>
        <div class="service-status">
          <span class="service-status-dot ${colorClass}"></span>
          <span class="service-status-label">${getStatusLabel(service.status)}</span>
        </div>
      </div>
      <div class="service-uptime">
        <div class="uptime-history">
          <div class="uptime-label">90-day uptime: ${uptimeDisplay}</div>
          ${uptimeBarHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a collapsible service group
 */
function renderServiceGroup(groupId, groupName, services, isCollapsed = false) {
  const contentClass = isCollapsed ? 'service-group-content collapsed' : 'service-group-content';
  const toggleClass = isCollapsed ? 'service-group-toggle collapsed' : 'service-group-toggle';
  
  return `
    <div class="service-group" data-group-id="${escapeHtml(groupId || 'general')}">
      <div class="service-group-header" onclick="toggleGroup(this)">
        <span class="service-group-title">${escapeHtml(groupName)}</span>
        <span class="${toggleClass}">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      </div>
      <div class="${contentClass}">
        ${services.map(renderServiceItem).join('')}
      </div>
    </div>
  `;
}

/**
 * Toggle group collapse/expand
 */
function toggleGroup(header) {
  const group = header.parentElement;
  const content = group.querySelector('.service-group-content');
  const toggle = group.querySelector('.service-group-toggle');
  
  content.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed');
}

/**
 * Render the services list with groups
 */
async function renderServices(services) {
  const container = document.getElementById('services-list');
  
  if (!services || services.length === 0) {
    container.innerHTML = '<div class="empty-state">No services being monitored</div>';
    return;
  }
  
  // Group services
  const { groups, ungrouped } = groupServices(services);
  
  // Fetch uptime data for all services in parallel
  const servicesWithUptime = await Promise.all(
    services.map(async (service) => {
      const uptimeData = await fetchServiceUptimeData(service.id);
      return { 
        ...service, 
        uptimePercent: uptimeData?.uptimePercent ?? null,
        uptimeHistory: uptimeData?.history ?? null
      };
    })
  );
  
  // Re-group after adding uptime data
  const grouped = groupServices(servicesWithUptime);
  
  let html = '';
  
  // Render grouped services
  Object.entries(grouped.groups).forEach(([groupId, groupServices]) => {
    // Use the first service's groupName if available, otherwise use groupId
    const groupName = groupServices[0]?.groupName || groupId;
    html += renderServiceGroup(groupId, groupName, groupServices);
  });
  
  // Render ungrouped services under "General" section
  if (grouped.ungrouped.length > 0) {
    html += renderServiceGroup('general', 'General', grouped.ungrouped);
  }
  
  container.innerHTML = html;
}

/**
 * Get status badge class for incident timeline
 */
function getStatusBadgeClass(status) {
  switch (status) {
    case 'investigating':
      return 'investigating';
    case 'identified':
      return 'identified';
    case 'monitoring':
      return 'monitoring';
    case 'resolved':
      return 'resolved';
    default:
      return '';
  }
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Render the incidents list with improved timeline styling
 */
function renderIncidents(incidents) {
  const container = document.getElementById('incidents-list');
  const section = document.getElementById('incidents-section');
  
  if (!incidents || incidents.length === 0) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  
  container.innerHTML = incidents.map(incident => {
    const timelineItems = (incident.timeline || []).map(update => {
      const badgeClass = getStatusBadgeClass(update.status);
      
      return `
        <div class="timeline-item">
          <div class="timeline-marker ${update.status}"></div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="incident-status-badge ${badgeClass}">${capitalize(update.status)}</span>
            </div>
            ${update.message ? `<div class="timeline-message">${escapeHtml(update.message)}</div>` : ''}
            <div class="timeline-time">${formatDate(update.createdAt)}</div>
          </div>
        </div>
      `;
    }).join('');
    
    return `
      <div class="incident-item">
        <div class="incident-header">
          <span class="incident-severity ${incident.severity}">${incident.severity.replace('_', ' ')}</span>
          <span class="incident-title">${escapeHtml(incident.title)}</span>
        </div>
        <div class="incident-timeline">
          ${timelineItems}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Fetch status data from the API
 */
async function fetchStatus() {
  try {
    const response = await fetch(API_STATUS_URL);
    const data = await response.json();
    
    if (data.ok) {
      statusData = data.data;
      renderOverallStatus(statusData.status);
      await renderServices(statusData.services);
    } else {
      console.error('Failed to fetch status:', data.error);
    }
  } catch (error) {
    console.error('Error fetching status:', error);
    const container = document.getElementById('services-list');
    container.innerHTML = '<div class="error">Failed to load status data. Please try again later.</div>';
  }
}

/**
 * Fetch incidents from the API
 */
async function fetchIncidents() {
  try {
    const response = await fetch(API_INCIDENTS_URL);
    const data = await response.json();
    
    if (data.ok) {
      incidentsData = data.data;
      renderIncidents(incidentsData);
    } else {
      console.error('Failed to fetch incidents:', data.error);
    }
  } catch (error) {
    console.error('Error fetching incidents:', error);
  }
}

/**
 * Refresh all data
 */
async function refreshData() {
  await Promise.all([
    fetchStatus(),
    fetchIncidents()
  ]);
  // Reset the countdown timer
  startRefreshTimer();
}

/**
 * Initialize the status page
 */
function init() {
  // Initialize theme
  initTheme();
  
  // Set up theme toggle button
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  
  // Initial data fetch
  refreshData();
  
  // Auto-refresh with countdown timer
  startRefreshTimer();
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
