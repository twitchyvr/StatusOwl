/**
 * StatusOwl — Status Page JavaScript
 * Fetches status data from API and renders the page
 */

// Configuration
const API_STATUS_URL = '/api/status';
const API_INCIDENTS_URL = '/api/incidents';
const REFRESH_INTERVAL = 60000; // 60 seconds

// State
let statusData = null;
let incidentsData = null;

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
 * Fetch service uptime from the API
 */
async function fetchServiceUptime(serviceId) {
  try {
    const response = await fetch(`/api/services/${serviceId}/uptime?period=90d`);
    const data = await response.json();
    if (data.ok && data.data) {
      return data.data.uptime;
    }
    return null;
  } catch (error) {
    console.error(`Failed to fetch uptime for service ${serviceId}:`, error);
    return null;
  }
}

/**
 * Render the services list
 */
async function renderServices(services) {
  const container = document.getElementById('services-list');
  
  if (!services || services.length === 0) {
    container.innerHTML = '<div class="empty-state">No services being monitored</div>';
    return;
  }
  
  // Fetch uptime for each service
  const servicesWithUptime = await Promise.all(
    services.map(async (service) => {
      const uptime = await fetchServiceUptime(service.id);
      return { ...service, uptime };
    })
  );
  
  container.innerHTML = servicesWithUptime.map(service => {
    const colorClass = getStatusColor(service.status);
    const uptimeDisplay = service.uptime !== null 
      ? `${service.uptime.toFixed(2)}%` 
      : 'N/A';
    
    return `
      <div class="service-item">
        <div class="service-info">
          <span class="service-name">${escapeHtml(service.name)}</span>
        </div>
        <div class="service-status">
          <span class="service-status-dot ${colorClass}"></span>
          <span class="service-status-label">${getStatusLabel(service.status)}</span>
        </div>
        <div class="service-uptime">
          <span class="service-uptime-value">${uptimeDisplay}</span>
          <span> uptime (90d)</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render the incidents list
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
    const timelineItems = (incident.timeline || []).map(update => `
      <div class="timeline-item">
        <div class="timeline-marker ${update.status}"></div>
        <div class="timeline-content">
          <div class="timeline-status">${escapeHtml(update.status)}</div>
          ${update.message ? `<div class="timeline-message">${escapeHtml(update.message)}</div>` : ''}
          <div class="timeline-time">${formatDate(update.createdAt)}</div>
        </div>
      </div>
    `).join('');
    
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
 * Initialize the status page
 */
function init() {
  // Initial fetch
  fetchStatus();
  fetchIncidents();
  
  // Auto-refresh
  setInterval(() => {
    fetchStatus();
    fetchIncidents();
  }, REFRESH_INTERVAL);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
