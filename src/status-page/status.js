/**
 * StatusOwl — Status Page JavaScript
 * Fetches status data from API and renders the page
 * Features: Dark mode, service groups, uptime history, incident badges, auto-refresh
 */

;(function () {
  'use strict';

  // Configuration
  var API_STATUS_URL = '/api/status';
  var API_INCIDENTS_URL = '/api/incidents';
  var REFRESH_INTERVAL = 60000; // 60 seconds
  var CACHE_TTL_MS = 10000; // 10 seconds cache

  // State
  var statusData = null;
  var incidentsData = null;
  var countdownInterval = null;
  var secondsUntilRefresh = REFRESH_INTERVAL / 1000;
  var lastFetchTime = null;
  var mediaQueryListener = null;

  // Simple response cache
  var responseCache = new Map();

  function getCached(url) {
    var entry = responseCache.get(url);
    if (entry && Date.now() - entry.time < CACHE_TTL_MS) {
      return entry.data;
    }
    responseCache.delete(url);
    return null;
  }

  function setCache(url, data) {
    responseCache.set(url, { data: data, time: Date.now() });
  }

  // Theme Management
  var THEME_KEY = 'statusowl-theme';

  function getThemePreference() {
    var savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) return savedTheme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    // Update aria-pressed on theme toggle
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  function toggleTheme() {
    var currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    var newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  }

  function initTheme() {
    var theme = getThemePreference();
    applyTheme(theme);

    // Listen for system theme changes — store reference for cleanup
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQueryListener = function (e) {
      if (!localStorage.getItem(THEME_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', mediaQueryListener);
  }

  // Auto-refresh Timer
  function startRefreshTimer() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
    }

    secondsUntilRefresh = REFRESH_INTERVAL / 1000;
    updateRefreshTimerDisplay();

    countdownInterval = setInterval(function () {
      secondsUntilRefresh--;
      updateRefreshTimerDisplay();

      if (secondsUntilRefresh <= 0) {
        refreshData();
      }
    }, 1000);
  }

  function updateRefreshTimerDisplay() {
    var timerDot = document.querySelector('.refresh-timer-dot');
    var timerText = document.querySelector('.refresh-timer-text');

    if (timerDot && timerText) {
      timerText.textContent = 'Refreshing in ' + secondsUntilRefresh + 's';

      if (secondsUntilRefresh > 0) {
        timerDot.classList.add('active');
      } else {
        timerDot.classList.remove('active');
      }
    }
  }

  function updateLastUpdated() {
    var el = document.getElementById('last-updated');
    if (el && lastFetchTime) {
      el.textContent = 'Last updated: ' + lastFetchTime.toLocaleTimeString();
    }
  }

  // Status helpers
  function getStatusColor(status) {
    switch (status) {
      case 'operational': return 'operational';
      case 'degraded': return 'degraded';
      case 'partial_outage': return 'partial-outage';
      case 'major_outage':
      case 'outage': return 'outage';
      case 'maintenance': return 'maintenance';
      default: return 'unknown';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'operational': return 'Operational';
      case 'degraded': return 'Degraded';
      case 'partial_outage': return 'Partial Outage';
      case 'major_outage': return 'Major Outage';
      case 'outage': return 'Outage';
      case 'maintenance': return 'Maintenance';
      default: return 'Unknown';
    }
  }

  function getOverallStatusLabel(status) {
    switch (status) {
      case 'operational': return 'All Systems Operational';
      case 'degraded': return 'Some Systems Degraded';
      case 'partial_outage': return 'Partial System Outage';
      case 'major_outage': return 'Major Outage';
      case 'maintenance': return 'Scheduled Maintenance';
      default: return 'Status Unknown';
    }
  }

  function formatDate(isoString) {
    var date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Rendering
  function renderOverallStatus(overallStatus) {
    var dot = document.getElementById('overall-dot');
    var text = document.getElementById('overall-text');
    var colorClass = getStatusColor(overallStatus);
    dot.className = 'status-dot ' + colorClass;
    text.className = 'status-text ' + colorClass;
    text.textContent = getOverallStatusLabel(overallStatus);
  }

  /**
   * Fetch uptime data for all services in a single batch.
   * Uses caching to avoid redundant requests.
   */
  async function fetchAllUptimeData(serviceIds) {
    var results = {};
    var promises = serviceIds.map(function (id) {
      var url = '/api/services/' + id + '/uptime?period=90d';
      var cached = getCached(url);
      if (cached) {
        results[id] = cached;
        return Promise.resolve();
      }
      return fetch(url)
        .then(function (response) {
          if (!response.ok) return null;
          return response.json();
        })
        .then(function (data) {
          if (data && data.ok && data.data) {
            results[id] = data.data;
            setCache('/api/services/' + id + '/uptime?period=90d', data.data);
          }
        })
        .catch(function () {
          // Silently ignore individual uptime fetch failures
        });
    });
    await Promise.all(promises);
    return results;
  }

  /** Create an SVG element for the toggle chevron */
  function createChevronSvg() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var polyline = document.createElementNS(ns, 'polyline');
    polyline.setAttribute('points', '6 9 12 15 18 9');
    svg.appendChild(polyline);
    return svg;
  }

  /**
   * Render uptime bar using DocumentFragment for DOM efficiency.
   */
  function renderUptimeBar(history) {
    var bar = document.createElement('div');
    bar.className = 'uptime-bar';

    var frag = document.createDocumentFragment();
    for (var j = 0; j < 90; j++) {
      var dayData = history && Array.isArray(history) ? history[j] : null;
      var cellClass = 'no-data';
      var title = 'No data';

      if (dayData) {
        title = dayData.status || 'unknown';
        switch (dayData.status) {
          case 'operational': cellClass = 'operational'; break;
          case 'degraded': cellClass = 'degraded'; break;
          case 'partial_outage': cellClass = 'partial-outage'; break;
          case 'outage':
          case 'major_outage': cellClass = 'outage'; break;
          case 'maintenance': cellClass = 'maintenance'; break;
          default: cellClass = 'no-data';
        }
      }

      var c = document.createElement('div');
      c.className = 'uptime-cell ' + cellClass;
      c.title = title;
      frag.appendChild(c);
    }

    bar.appendChild(frag);
    return bar;
  }

  function groupServices(services) {
    var groups = {};
    var ungrouped = [];

    services.forEach(function (service) {
      if (service.groupId) {
        if (!groups[service.groupId]) {
          groups[service.groupId] = [];
        }
        groups[service.groupId].push(service);
      } else {
        ungrouped.push(service);
      }
    });

    return { groups: groups, ungrouped: ungrouped };
  }

  function renderServiceItem(service) {
    var colorClass = getStatusColor(service.status);
    var uptimeDisplay = service.uptimePercent != null
      ? service.uptimePercent.toFixed(2) + '%'
      : 'N/A';

    var item = document.createElement('div');
    item.className = 'service-item';

    var info = document.createElement('div');
    info.className = 'service-info';

    var name = document.createElement('span');
    name.className = 'service-name';
    name.textContent = service.name;

    var status = document.createElement('div');
    status.className = 'service-status';

    var dot = document.createElement('span');
    dot.className = 'service-status-dot ' + colorClass;

    var label = document.createElement('span');
    label.className = 'service-status-label';
    label.textContent = getStatusLabel(service.status);

    status.appendChild(dot);
    status.appendChild(label);
    info.appendChild(name);
    info.appendChild(status);

    var uptime = document.createElement('div');
    uptime.className = 'service-uptime';

    var history = document.createElement('div');
    history.className = 'uptime-history';

    var uptimeLabel = document.createElement('div');
    uptimeLabel.className = 'uptime-label';
    uptimeLabel.textContent = '90-day uptime: ' + uptimeDisplay;

    history.appendChild(uptimeLabel);
    history.appendChild(renderUptimeBar(service.uptimeHistory));
    uptime.appendChild(history);

    item.appendChild(info);
    item.appendChild(uptime);

    return item;
  }

  /**
   * Render a collapsible service group using DOM APIs + addEventListener.
   * Includes ARIA attributes for accessibility.
   */
  function renderServiceGroup(groupId, groupName, services, isCollapsed) {
    isCollapsed = isCollapsed || false;

    var group = document.createElement('div');
    group.className = 'service-group';
    group.dataset.groupId = groupId || 'general';

    // Use a <button> for the header for keyboard accessibility
    var header = document.createElement('button');
    header.className = 'service-group-header';
    header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    header.type = 'button';

    var title = document.createElement('span');
    title.className = 'service-group-title';
    title.textContent = groupName;

    var toggleSpan = document.createElement('span');
    toggleSpan.className = isCollapsed ? 'service-group-toggle collapsed' : 'service-group-toggle';
    toggleSpan.appendChild(createChevronSvg());

    header.appendChild(title);
    header.appendChild(toggleSpan);

    var content = document.createElement('div');
    content.className = isCollapsed ? 'service-group-content collapsed' : 'service-group-content';
    content.id = 'group-content-' + (groupId || 'general');
    header.setAttribute('aria-controls', content.id);

    services.forEach(function (service) {
      content.appendChild(renderServiceItem(service));
    });

    // addEventListener instead of inline onclick
    header.addEventListener('click', function () {
      var isNowCollapsed = content.classList.toggle('collapsed');
      toggleSpan.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', isNowCollapsed ? 'false' : 'true');
    });

    group.appendChild(header);
    group.appendChild(content);

    return group;
  }

  function clearElement(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  async function renderServices(services) {
    var container = document.getElementById('services-list');

    if (!services || services.length === 0) {
      clearElement(container);
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No services being monitored';
      container.appendChild(empty);
      return;
    }

    // Fetch uptime data for all services in parallel (fixes N+1)
    var serviceIds = services.map(function (s) { return s.id; });
    var uptimeMap = await fetchAllUptimeData(serviceIds);

    var servicesWithUptime = services.map(function (service) {
      var uptimeData = uptimeMap[service.id] || null;
      return Object.assign({}, service, {
        uptimePercent: uptimeData ? uptimeData.uptimePercent : null,
        uptimeHistory: uptimeData ? uptimeData.history : null,
      });
    });

    var grouped = groupServices(servicesWithUptime);

    // Build DOM using DocumentFragment
    var frag = document.createDocumentFragment();

    Object.keys(grouped.groups).forEach(function (groupId) {
      var grpServices = grouped.groups[groupId];
      var groupName = grpServices[0] && grpServices[0].groupName ? grpServices[0].groupName : groupId;
      frag.appendChild(renderServiceGroup(groupId, groupName, grpServices));
    });

    if (grouped.ungrouped.length > 0) {
      frag.appendChild(renderServiceGroup('general', 'General', grouped.ungrouped));
    }

    clearElement(container);
    container.appendChild(frag);
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'investigating': return 'investigating';
      case 'identified': return 'identified';
      case 'monitoring': return 'monitoring';
      case 'resolved': return 'resolved';
      default: return '';
    }
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function renderIncidents(incidents) {
    var container = document.getElementById('incidents-list');
    var section = document.getElementById('incidents-section');

    if (!incidents || incidents.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    var frag = document.createDocumentFragment();

    incidents.forEach(function (incident) {
      var item = document.createElement('div');
      item.className = 'incident-item';

      var header = document.createElement('div');
      header.className = 'incident-header';

      var severity = document.createElement('span');
      severity.className = 'incident-severity ' + escapeHtml(incident.severity);
      severity.textContent = (incident.severity || '').replace('_', ' ');

      var titleSpan = document.createElement('span');
      titleSpan.className = 'incident-title';
      titleSpan.textContent = incident.title;

      header.appendChild(severity);
      header.appendChild(titleSpan);

      var timeline = document.createElement('div');
      timeline.className = 'incident-timeline';

      (incident.timeline || []).forEach(function (update) {
        var timelineItem = document.createElement('div');
        timelineItem.className = 'timeline-item';

        var marker = document.createElement('div');
        marker.className = 'timeline-marker ' + (update.status || '');

        var contentDiv = document.createElement('div');
        contentDiv.className = 'timeline-content';

        var timelineHeader = document.createElement('div');
        timelineHeader.className = 'timeline-header';

        var badge = document.createElement('span');
        badge.className = 'incident-status-badge ' + getStatusBadgeClass(update.status);
        badge.textContent = capitalize(update.status);
        timelineHeader.appendChild(badge);

        contentDiv.appendChild(timelineHeader);

        if (update.message) {
          var msg = document.createElement('div');
          msg.className = 'timeline-message';
          msg.textContent = update.message;
          contentDiv.appendChild(msg);
        }

        var time = document.createElement('div');
        time.className = 'timeline-time';
        time.textContent = formatDate(update.createdAt);
        contentDiv.appendChild(time);

        timelineItem.appendChild(marker);
        timelineItem.appendChild(contentDiv);
        timeline.appendChild(timelineItem);
      });

      item.appendChild(header);
      item.appendChild(timeline);
      frag.appendChild(item);
    });

    clearElement(container);
    container.appendChild(frag);
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;');
  }

  function showError(container, message) {
    clearElement(container);
    var errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;

    var actions = document.createElement('div');
    actions.className = 'error-actions';

    var retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', function () {
      clearElement(container);
      var loading = document.createElement('div');
      loading.className = 'loading';
      loading.textContent = 'Loading services...';
      container.appendChild(loading);
      refreshData();
    });
    actions.appendChild(retryBtn);
    errorDiv.appendChild(actions);
    container.appendChild(errorDiv);
  }

  async function fetchStatus() {
    try {
      var cached = getCached(API_STATUS_URL);
      var data;
      if (cached) {
        data = cached;
      } else {
        var response = await fetch(API_STATUS_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        data = await response.json();
        setCache(API_STATUS_URL, data);
      }

      if (data.ok) {
        statusData = data.data;
        renderOverallStatus(statusData.status);
        await renderServices(statusData.services);
        lastFetchTime = new Date();
        updateLastUpdated();
      } else {
        console.error('Failed to fetch status:', data.error);
        showError(document.getElementById('services-list'), 'Failed to load status data.');
      }
    } catch (error) {
      console.error('Error fetching status:', error);
      showError(document.getElementById('services-list'), 'Failed to load status data. Please try again later.');
    }
  }

  async function fetchIncidents() {
    try {
      var cached = getCached(API_INCIDENTS_URL);
      var data;
      if (cached) {
        data = cached;
      } else {
        var response = await fetch(API_INCIDENTS_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        data = await response.json();
        setCache(API_INCIDENTS_URL, data);
      }

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

  async function refreshData() {
    // Clear cache on manual/auto refresh
    responseCache.clear();

    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('refreshing');

    await Promise.all([fetchStatus(), fetchIncidents()]);

    if (refreshBtn) refreshBtn.classList.remove('refreshing');
    startRefreshTimer();
  }

  function init() {
    initTheme();

    // Theme toggle
    var themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', toggleTheme);
    }

    // Manual refresh button
    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshData();
      });
    }

    // Initial data fetch
    refreshData();
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
