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
  var API_MAINTENANCE_URL = '/api/maintenance-windows?active=true';
  var API_GROUPS_URL = '/api/groups';
  var REFRESH_INTERVAL = 60000; // 60 seconds
  var CACHE_TTL_MS = 10000; // 10 seconds cache

  // State
  var statusData = null;
  var incidentsData = null;
  var maintenanceWindows = [];
  var groupsData = [];
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

  // -------------------------------------------------------------------
  // SSL Badge helpers
  // -------------------------------------------------------------------

  /**
   * Determine SSL status class based on certificate data.
   * Returns one of: 'ssl-ok', 'ssl-warning', 'ssl-critical', 'ssl-unknown'
   */
  function getSslClass(ssl) {
    if (!ssl || !ssl.valid) return ssl ? 'ssl-critical' : 'ssl-unknown';
    var daysUntilExpiry = ssl.daysUntilExpiry != null ? ssl.daysUntilExpiry : Infinity;
    if (daysUntilExpiry < 7) return 'ssl-critical';
    if (daysUntilExpiry <= 30) return 'ssl-warning';
    return 'ssl-ok';
  }

  /**
   * Build the tooltip text for an SSL badge.
   */
  function getSslTooltip(ssl) {
    if (!ssl) return 'No SSL data';
    if (!ssl.valid) return 'SSL invalid or expired';
    var days = ssl.daysUntilExpiry != null ? ssl.daysUntilExpiry : '?';
    var expiry = ssl.expiresAt ? formatDate(ssl.expiresAt) : 'unknown';
    return 'SSL valid — expires ' + expiry + ' (' + days + ' days)';
  }

  /**
   * Create an SSL badge DOM element (lock icon SVG with color class + tooltip).
   */
  function createSslBadge(ssl) {
    var ns = 'http://www.w3.org/2000/svg';
    var cssClass = getSslClass(ssl);

    var wrapper = document.createElement('span');
    wrapper.className = 'ssl-badge ' + cssClass;

    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');

    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d',
      'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 ' +
      '2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 ' +
      '2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z');
    svg.appendChild(path);
    wrapper.appendChild(svg);

    // Tooltip
    var tooltip = document.createElement('span');
    tooltip.className = 'ssl-tooltip';
    tooltip.textContent = getSslTooltip(ssl);
    wrapper.appendChild(tooltip);

    return wrapper;
  }

  /**
   * Fetch SSL data for a single service. Returns null on failure.
   */
  async function fetchSslData(serviceId) {
    var url = '/api/services/' + serviceId + '/ssl';
    var cached = getCached(url);
    if (cached) return cached;
    try {
      var response = await fetch(url);
      if (!response.ok) return null;
      var data = await response.json();
      if (data && data.ok && data.data) {
        setCache(url, data.data);
        return data.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetch SSL data for all services in parallel.
   */
  async function fetchAllSslData(serviceIds) {
    var results = {};
    var promises = serviceIds.map(function (id) {
      return fetchSslData(id).then(function (data) {
        results[id] = data;
      });
    });
    await Promise.all(promises);
    return results;
  }

  // -------------------------------------------------------------------
  // Response-time sparkline helpers
  // -------------------------------------------------------------------

  /**
   * Fetch percentile data for a single service. Returns null on failure.
   */
  async function fetchPercentileData(serviceId) {
    var url = '/api/services/' + serviceId + '/percentiles?hours=24';
    var cached = getCached(url);
    if (cached) return cached;
    try {
      var response = await fetch(url);
      if (!response.ok) return null;
      var data = await response.json();
      if (data && data.ok && data.data) {
        setCache(url, data.data);
        return data.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetch percentile data for all services in parallel.
   */
  async function fetchAllPercentileData(serviceIds) {
    var results = {};
    var promises = serviceIds.map(function (id) {
      return fetchPercentileData(id).then(function (data) {
        results[id] = data;
      });
    });
    await Promise.all(promises);
    return results;
  }

  /**
   * Pick sparkline color based on the average p50 value.
   */
  function sparklineColor(p50Values) {
    if (!p50Values || p50Values.length === 0) return 'var(--color-text-secondary)';
    var sum = 0;
    for (var i = 0; i < p50Values.length; i++) sum += p50Values[i];
    var avg = sum / p50Values.length;
    if (avg > 500) return 'var(--color-outage)';
    if (avg > 200) return 'var(--color-degraded)';
    return 'var(--color-operational)';
  }

  /**
   * Build an SVG polyline path string from an array of numeric values.
   * Maps values into the given width x height viewport.
   */
  function buildSparklinePath(values, width, height, padding) {
    if (!values || values.length === 0) return '';
    padding = padding || 1;
    var maxVal = 0;
    for (var i = 0; i < values.length; i++) {
      if (values[i] > maxVal) maxVal = values[i];
    }
    if (maxVal === 0) maxVal = 1; // avoid division by zero

    var usableW = width - padding * 2;
    var usableH = height - padding * 2;
    var step = values.length > 1 ? usableW / (values.length - 1) : 0;

    var points = [];
    for (var j = 0; j < values.length; j++) {
      var x = padding + j * step;
      var y = padding + usableH - (values[j] / maxVal) * usableH;
      points.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    return points.join(' ');
  }

  /**
   * Create an inline SVG sparkline element from percentile data.
   * Shows p50 as a solid line and p95 as a faded overlay.
   */
  function createSparkline(percentileData) {
    var container = document.createElement('span');
    container.className = 'sparkline-container';

    // Extract p50 and p95 arrays from the data
    var buckets = (percentileData && percentileData.buckets) ? percentileData.buckets : [];
    if (buckets.length === 0) {
      var empty = document.createElement('span');
      empty.className = 'sparkline-empty';
      empty.textContent = 'No data';
      container.appendChild(empty);
      return container;
    }

    var p50Values = [];
    var p95Values = [];
    for (var i = 0; i < buckets.length; i++) {
      p50Values.push(typeof buckets[i].p50 === 'number' ? buckets[i].p50 : 0);
      p95Values.push(typeof buckets[i].p95 === 'number' ? buckets[i].p95 : 0);
    }

    var W = 120;
    var H = 30;
    var ns = 'http://www.w3.org/2000/svg';

    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('aria-label', 'Response time sparkline');
    svg.setAttribute('role', 'img');

    // p95 line (faded)
    var p95Path = buildSparklinePath(p95Values, W, H);
    if (p95Path) {
      var p95Line = document.createElementNS(ns, 'polyline');
      p95Line.setAttribute('points', p95Path);
      p95Line.setAttribute('fill', 'none');
      p95Line.setAttribute('stroke', sparklineColor(p95Values));
      p95Line.setAttribute('stroke-opacity', '0.25');
      p95Line.setAttribute('stroke-width', '1');
      p95Line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p95Line);
    }

    // p50 line (solid)
    var p50Path = buildSparklinePath(p50Values, W, H);
    if (p50Path) {
      var p50Line = document.createElementNS(ns, 'polyline');
      p50Line.setAttribute('points', p50Path);
      p50Line.setAttribute('fill', 'none');
      p50Line.setAttribute('stroke', sparklineColor(p50Values));
      p50Line.setAttribute('stroke-opacity', '1');
      p50Line.setAttribute('stroke-width', '1.5');
      p50Line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(p50Line);
    }

    container.appendChild(svg);
    return container;
  }

  // -------------------------------------------------------------------
  // Maintenance helpers
  // -------------------------------------------------------------------

  /**
   * Fetch active maintenance windows.
   */
  async function fetchMaintenanceWindows() {
    try {
      var cached = getCached(API_MAINTENANCE_URL);
      var data;
      if (cached) {
        data = cached;
      } else {
        var response = await fetch(API_MAINTENANCE_URL);
        if (!response.ok) return;
        data = await response.json();
        setCache(API_MAINTENANCE_URL, data);
      }
      if (data && data.ok) {
        maintenanceWindows = data.data || [];
      } else {
        maintenanceWindows = [];
      }
    } catch (e) {
      maintenanceWindows = [];
    }
    renderMaintenanceBanner();
  }

  /**
   * Render the maintenance banner at the top of the page.
   */
  function renderMaintenanceBanner() {
    var banner = document.getElementById('maintenance-banner');
    if (!banner) return;

    if (!maintenanceWindows || maintenanceWindows.length === 0) {
      banner.style.display = 'none';
      clearElement(banner);
      return;
    }

    banner.style.display = 'flex';
    clearElement(banner);

    // Wrench icon
    var ns = 'http://www.w3.org/2000/svg';
    var iconSvg = document.createElementNS(ns, 'svg');
    iconSvg.setAttribute('class', 'maintenance-banner-icon');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    iconSvg.setAttribute('fill', 'none');
    iconSvg.setAttribute('stroke', 'currentColor');
    iconSvg.setAttribute('stroke-width', '2');
    iconSvg.setAttribute('stroke-linecap', 'round');
    iconSvg.setAttribute('stroke-linejoin', 'round');
    iconSvg.setAttribute('aria-hidden', 'true');
    var wrenchPath = document.createElementNS(ns, 'path');
    wrenchPath.setAttribute('d',
      'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 ' +
      '7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z');
    iconSvg.appendChild(wrenchPath);
    banner.appendChild(iconSvg);

    var itemsContainer = document.createElement('div');
    itemsContainer.className = 'maintenance-banner-items';

    for (var i = 0; i < maintenanceWindows.length; i++) {
      var mw = maintenanceWindows[i];
      var item = document.createElement('div');
      item.className = 'maintenance-banner-item';

      var titleSpan = document.createElement('span');
      titleSpan.className = 'maintenance-banner-title';
      titleSpan.textContent = 'Scheduled Maintenance: ' + (mw.title || 'Unnamed');
      item.appendChild(titleSpan);

      var timeSpan = document.createElement('span');
      timeSpan.className = 'maintenance-banner-time';
      var startStr = mw.startTime ? formatDate(mw.startTime) : '?';
      var endStr = mw.endTime ? formatDate(mw.endTime) : '?';
      timeSpan.textContent = ' — ' + startStr + ' to ' + endStr;
      item.appendChild(timeSpan);

      itemsContainer.appendChild(item);
    }

    banner.appendChild(itemsContainer);
  }

  /**
   * Check if a service is currently under active maintenance.
   */
  function isServiceInMaintenance(serviceId) {
    if (!maintenanceWindows || maintenanceWindows.length === 0) return false;
    for (var i = 0; i < maintenanceWindows.length; i++) {
      var mw = maintenanceWindows[i];
      var services = mw.serviceIds || mw.services || [];
      for (var j = 0; j < services.length; j++) {
        if (services[j] === serviceId) return true;
      }
    }
    return false;
  }

  /**
   * Create a wrench icon element for services under maintenance.
   */
  function createMaintenanceIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var wrapper = document.createElement('span');
    wrapper.className = 'maintenance-icon';
    wrapper.title = 'Under maintenance';

    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d',
      'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 ' +
      '7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z');
    svg.appendChild(path);
    wrapper.appendChild(svg);
    return wrapper;
  }

  // -------------------------------------------------------------------
  // Groups helpers
  // -------------------------------------------------------------------

  /**
   * Fetch service groups from the API.
   */
  async function fetchGroups() {
    try {
      var cached = getCached(API_GROUPS_URL);
      var data;
      if (cached) {
        data = cached;
      } else {
        var response = await fetch(API_GROUPS_URL);
        if (!response.ok) return;
        data = await response.json();
        setCache(API_GROUPS_URL, data);
      }
      if (data && data.ok) {
        groupsData = data.data || [];
      } else {
        groupsData = [];
      }
    } catch (e) {
      groupsData = [];
    }
  }

  /**
   * Look up the group name from the cached groups data.
   */
  function getGroupName(groupId) {
    for (var i = 0; i < groupsData.length; i++) {
      if (groupsData[i].id === groupId) return groupsData[i].name;
    }
    return null;
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
    var inMaintenance = isServiceInMaintenance(service.id);

    var item = document.createElement('div');
    item.className = 'service-item';

    var info = document.createElement('div');
    info.className = 'service-info';

    var name = document.createElement('span');
    name.className = 'service-name';
    name.textContent = service.name;

    var status = document.createElement('div');
    status.className = 'service-status';

    // Show wrench icon instead of status dot when under maintenance
    if (inMaintenance) {
      status.appendChild(createMaintenanceIcon());
    } else {
      var dot = document.createElement('span');
      dot.className = 'service-status-dot ' + colorClass;
      status.appendChild(dot);
    }

    var label = document.createElement('span');
    label.className = 'service-status-label';
    label.textContent = inMaintenance ? 'Maintenance' : getStatusLabel(service.status);

    status.appendChild(label);
    info.appendChild(name);
    info.appendChild(status);

    // Service meta: SSL badge + sparkline
    var meta = document.createElement('div');
    meta.className = 'service-meta';

    // SSL badge
    meta.appendChild(createSslBadge(service._sslData || null));

    // Sparkline
    meta.appendChild(createSparkline(service._percentileData || null));

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
    item.appendChild(meta);
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

    // Fetch uptime, SSL, and percentile data for all services in parallel
    var serviceIds = services.map(function (s) { return s.id; });
    var results = await Promise.all([
      fetchAllUptimeData(serviceIds),
      fetchAllSslData(serviceIds),
      fetchAllPercentileData(serviceIds),
    ]);
    var uptimeMap = results[0];
    var sslMap = results[1];
    var percentileMap = results[2];

    var servicesWithData = services.map(function (service) {
      var uptimeData = uptimeMap[service.id] || null;
      return Object.assign({}, service, {
        uptimePercent: uptimeData ? uptimeData.uptimePercent : null,
        uptimeHistory: uptimeData ? uptimeData.history : null,
        _sslData: sslMap[service.id] || null,
        _percentileData: percentileMap[service.id] || null,
      });
    });

    var grouped = groupServices(servicesWithData);

    // Build DOM using DocumentFragment
    var frag = document.createDocumentFragment();

    Object.keys(grouped.groups).forEach(function (groupId) {
      var grpServices = grouped.groups[groupId];
      // Prefer group name from the groups API, fall back to service-embedded name, then groupId
      var groupName = getGroupName(groupId)
        || (grpServices[0] && grpServices[0].groupName ? grpServices[0].groupName : null)
        || groupId;
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

  // -------------------------------------------------------------------
  // Calendar (GitHub contribution-graph style)
  // -------------------------------------------------------------------

  var API_CALENDAR_URL = '/api/calendar';

  /**
   * Calendar heat-map colors — reads from CSS custom properties so they
   * automatically switch between light and dark theme.
   */
  function getCalendarColors() {
    var style = getComputedStyle(document.documentElement);
    return {
      4: style.getPropertyValue('--color-calendar-level-4').trim() || '#2d6a4f',
      3: style.getPropertyValue('--color-calendar-level-3').trim() || '#52b788',
      2: style.getPropertyValue('--color-calendar-level-2').trim() || '#b7e4c7',
      1: style.getPropertyValue('--color-calendar-level-1').trim() || '#fca311',
      0: style.getPropertyValue('--color-calendar-level-0').trim() || '#e63946',
    };
  }

  // Lazy-initialized; refreshed each time the calendar renders
  var CALENDAR_COLORS = null;

  var CALENDAR_CELL_SIZE = 12;
  var CALENDAR_GAP = 2;
  var CALENDAR_DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  var CALENDAR_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /**
   * Fetch overall calendar data from the API.
   */
  async function fetchCalendarData(days) {
    days = days || 90;
    var url = API_CALENDAR_URL + '?days=' + days;
    var cached = getCached(url);
    if (cached) return cached;
    try {
      var response = await fetch(url);
      if (!response.ok) return null;
      var json = await response.json();
      if (json && json.ok && json.data) {
        setCache(url, json.data);
        return json.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Render a GitHub-contribution-graph-style calendar into the given
   * container element. calendarData is an array of CalendarDay objects
   * sorted ascending by date.
   *
   * Layout:
   *   - 7 rows (Sun=0 .. Sat=6)
   *   - N columns (one per week)
   *   - Day labels on the left (Mon, Wed, Fri)
   *   - Month labels on top
   */
  function renderCalendar(containerId, calendarData) {
    // Refresh calendar colors from CSS custom properties (theme-aware)
    CALENDAR_COLORS = getCalendarColors();

    var container = document.getElementById(containerId);
    if (!container) return;

    clearElement(container);

    if (!calendarData || calendarData.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'calendar-empty';
      empty.textContent = 'No uptime data available';
      container.appendChild(empty);
      return;
    }

    // Determine the grid layout: need to figure out which column (week)
    // each day falls in, relative to the first Sunday at or before the
    // first date in the data.

    var firstDate = new Date(calendarData[0].date + 'T00:00:00');
    var lastDate = new Date(calendarData[calendarData.length - 1].date + 'T00:00:00');

    // Adjust firstDate back to the preceding Sunday
    var firstDow = firstDate.getDay(); // 0=Sun
    var gridStart = new Date(firstDate);
    gridStart.setDate(gridStart.getDate() - firstDow);

    // Build a map of date -> CalendarDay for fast lookup
    var dayMap = {};
    for (var i = 0; i < calendarData.length; i++) {
      dayMap[calendarData[i].date] = calendarData[i];
    }

    // How many weeks do we need?
    var diffMs = lastDate.getTime() - gridStart.getTime();
    var totalDays = Math.ceil(diffMs / 86400000) + 1;
    var numWeeks = Math.ceil(totalDays / 7);

    // SVG namespace
    var ns = 'http://www.w3.org/2000/svg';

    // Calculate dimensions
    var labelWidth = 30; // space for day labels on the left
    var monthLabelHeight = 16; // space for month labels on top
    var svgWidth = labelWidth + numWeeks * (CALENDAR_CELL_SIZE + CALENDAR_GAP);
    var svgHeight = monthLabelHeight + 7 * (CALENDAR_CELL_SIZE + CALENDAR_GAP);

    // Create wrapper div for horizontal scrolling on mobile
    var wrapper = document.createElement('div');
    wrapper.className = 'calendar-grid';

    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(svgWidth));
    svg.setAttribute('height', String(svgHeight));
    svg.setAttribute('viewBox', '0 0 ' + svgWidth + ' ' + svgHeight);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Uptime history calendar showing daily uptime levels');

    // Day labels (Mon, Wed, Fri)
    for (var row = 0; row < 7; row++) {
      var labelText = CALENDAR_DAY_LABELS[row];
      if (!labelText) continue;

      var dayLabel = document.createElementNS(ns, 'text');
      dayLabel.setAttribute('x', String(labelWidth - 4));
      dayLabel.setAttribute('y', String(monthLabelHeight + row * (CALENDAR_CELL_SIZE + CALENDAR_GAP) + CALENDAR_CELL_SIZE - 1));
      dayLabel.setAttribute('text-anchor', 'end');
      dayLabel.setAttribute('class', 'calendar-day-label');
      dayLabel.textContent = labelText;
      svg.appendChild(dayLabel);
    }

    // Month labels — track which months appear at which column
    var monthLabelsPlaced = {};

    // Render cells
    for (var col = 0; col < numWeeks; col++) {
      for (var r = 0; r < 7; r++) {
        var dayOffset = col * 7 + r;
        var cellDate = new Date(gridStart);
        cellDate.setDate(cellDate.getDate() + dayOffset);

        // Don't render cells beyond the last date
        if (cellDate > lastDate) continue;
        // Don't render cells before the first date in our data
        if (cellDate < firstDate) continue;

        var dateStr = cellDate.toISOString().slice(0, 10);
        var dayData = dayMap[dateStr];

        // Month label: place at the first column where a month's 1st appears
        var cellMonth = cellDate.getMonth();
        var cellDay = cellDate.getDate();
        if (cellDay <= 7 && r === 0 && !monthLabelsPlaced[cellMonth + '-' + cellDate.getFullYear()]) {
          monthLabelsPlaced[cellMonth + '-' + cellDate.getFullYear()] = true;
          var monthLabel = document.createElementNS(ns, 'text');
          monthLabel.setAttribute('x', String(labelWidth + col * (CALENDAR_CELL_SIZE + CALENDAR_GAP)));
          monthLabel.setAttribute('y', String(monthLabelHeight - 4));
          monthLabel.setAttribute('class', 'calendar-month-label');
          monthLabel.textContent = CALENDAR_MONTH_NAMES[cellMonth];
          svg.appendChild(monthLabel);
        }

        var level = dayData ? dayData.level : 4; // Default to excellent for days without data
        var fillColor = CALENDAR_COLORS[level];

        // If no data exists (no checks), use a neutral gray
        if (!dayData || dayData.totalChecks === 0) {
          fillColor = 'var(--color-border, #e2e8f0)';
        }

        var x = labelWidth + col * (CALENDAR_CELL_SIZE + CALENDAR_GAP);
        var y = monthLabelHeight + r * (CALENDAR_CELL_SIZE + CALENDAR_GAP);

        var rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(CALENDAR_CELL_SIZE));
        rect.setAttribute('height', String(CALENDAR_CELL_SIZE));
        rect.setAttribute('rx', '2');
        rect.setAttribute('ry', '2');
        rect.setAttribute('fill', fillColor);
        rect.setAttribute('class', 'calendar-cell');
        rect.setAttribute('data-date', dateStr);

        // Build tooltip data attributes
        if (dayData) {
          rect.setAttribute('data-uptime', dayData.uptimePercent.toFixed(2));
          rect.setAttribute('data-checks', String(dayData.totalChecks));
          rect.setAttribute('data-incidents', String(dayData.incidentCount));
          rect.setAttribute('data-response', dayData.avgResponseTime.toFixed(0));
        }

        svg.appendChild(rect);
      }
    }

    wrapper.appendChild(svg);

    // Tooltip element (shared, repositioned on hover)
    var tooltip = document.createElement('div');
    tooltip.className = 'calendar-tooltip';
    tooltip.style.display = 'none';
    wrapper.appendChild(tooltip);

    // Event delegation for hover on calendar cells
    wrapper.addEventListener('mouseover', function (e) {
      var target = e.target;
      if (target.tagName !== 'rect' || !target.classList.contains('calendar-cell')) return;

      var date = target.getAttribute('data-date');
      var uptime = target.getAttribute('data-uptime');
      var checks = target.getAttribute('data-checks');
      var incidents = target.getAttribute('data-incidents');
      var response = target.getAttribute('data-response');

      if (!date) return;

      var lines = [];
      lines.push(date);
      if (uptime !== null) {
        lines.push('Uptime: ' + uptime + '%');
        lines.push('Checks: ' + checks);
        if (parseInt(incidents) > 0) {
          lines.push('Incidents: ' + incidents);
        }
        lines.push('Avg response: ' + response + 'ms');
      } else {
        lines.push('No data');
      }

      tooltip.textContent = '';
      for (var li = 0; li < lines.length; li++) {
        if (li > 0) {
          tooltip.appendChild(document.createElement('br'));
        }
        tooltip.appendChild(document.createTextNode(lines[li]));
      }

      // Position tooltip above the cell
      var rectBounds = target.getBoundingClientRect();
      var wrapperBounds = wrapper.getBoundingClientRect();
      var tooltipLeft = rectBounds.left - wrapperBounds.left + rectBounds.width / 2;
      var tooltipTop = rectBounds.top - wrapperBounds.top - 6;

      tooltip.style.display = 'block';
      tooltip.style.left = tooltipLeft + 'px';
      tooltip.style.top = tooltipTop + 'px';
    });

    wrapper.addEventListener('mouseout', function (e) {
      var target = e.target;
      if (target.tagName === 'rect' && target.classList.contains('calendar-cell')) {
        tooltip.style.display = 'none';
      }
    });

    // Legend
    var legend = document.createElement('div');
    legend.className = 'calendar-legend';

    var lessLabel = document.createElement('span');
    lessLabel.className = 'calendar-legend-label';
    lessLabel.textContent = 'Less';
    legend.appendChild(lessLabel);

    var levelOrder = [0, 1, 2, 3, 4];
    for (var lv = 0; lv < levelOrder.length; lv++) {
      var swatch = document.createElement('span');
      swatch.className = 'calendar-legend-swatch';
      swatch.style.backgroundColor = CALENDAR_COLORS[levelOrder[lv]];
      legend.appendChild(swatch);
    }

    var moreLabel = document.createElement('span');
    moreLabel.className = 'calendar-legend-label';
    moreLabel.textContent = 'More';
    legend.appendChild(moreLabel);

    container.appendChild(wrapper);
    container.appendChild(legend);
  }

  /**
   * Fetch calendar data and render into the page.
   */
  async function loadCalendar() {
    var data = await fetchCalendarData(90);
    renderCalendar('uptime-calendar', data);
  }

  async function refreshData() {
    // Clear cache on manual/auto refresh
    responseCache.clear();

    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('refreshing');

    // Fetch groups and maintenance first (needed before rendering services)
    await Promise.all([fetchGroups(), fetchMaintenanceWindows()]);
    // Then fetch status + incidents + calendar (status rendering uses groups + maintenance state)
    await Promise.all([fetchStatus(), fetchIncidents(), loadCalendar()]);

    if (refreshBtn) refreshBtn.classList.remove('refreshing');
    startRefreshTimer();
  }

  // -------------------------------------------------------------------
  // Branding
  // -------------------------------------------------------------------

  async function applyBranding() {
    try {
      var response = await fetch('/api/branding');
      if (!response.ok) return;
      var json = await response.json();
      var data = json.data;

      // Apply site name
      if (data.siteName) {
        document.title = data.siteName;
        var titleEl = document.querySelector('.site-title');
        if (titleEl) titleEl.textContent = data.siteName;
      }

      // Apply site description
      if (data.siteDescription) {
        var descEl = document.querySelector('.site-description');
        if (descEl) descEl.textContent = data.siteDescription;
      }

      // Apply logo
      if (data.logoUrl) {
        var logoEl = document.querySelector('.site-logo');
        if (logoEl) {
          var img = document.createElement('img');
          img.src = data.logoUrl;
          img.alt = data.siteName || 'Logo';
          img.style.height = '32px';
          img.style.marginRight = '8px';
          logoEl.innerHTML = '';
          logoEl.appendChild(img);
        }
      }

      // Apply colors as CSS custom properties
      if (data.primaryColor) {
        document.documentElement.style.setProperty('--brand-primary', data.primaryColor);
      }
      if (data.accentColor) {
        document.documentElement.style.setProperty('--brand-accent', data.accentColor);
      }

      // Apply favicon
      if (data.faviconUrl) {
        var link = document.querySelector('link[rel="icon"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = data.faviconUrl;
      }
    } catch (e) {
      console.error('Failed to load branding:', e);
    }
  }

  // -------------------------------------------------------------------
  // Server-Sent Events (SSE) — real-time updates
  // -------------------------------------------------------------------

  var SSE_URL = '/api/events';
  var sseSource = null;
  var sseReconnectDelay = 1000; // start at 1 s
  var SSE_MAX_RECONNECT_DELAY = 8000; // cap at 8 s
  var sseReconnectTimer = null;
  var sseConnected = false;

  /**
   * Update the SSE connection indicator dot in the header.
   * Green = connected, red = disconnected.
   */
  function updateSseIndicator(connected) {
    sseConnected = connected;
    var indicator = document.getElementById('sse-indicator');
    if (!indicator) return;
    if (connected) {
      indicator.classList.add('connected');
      indicator.classList.remove('disconnected');
      indicator.title = 'Live updates connected';
    } else {
      indicator.classList.remove('connected');
      indicator.classList.add('disconnected');
      indicator.title = 'Live updates disconnected — using polling';
    }
  }

  /**
   * Handle a status.change SSE event.
   * Updates the specific service's status dot and label without a full refresh.
   */
  function handleStatusChange(eventData) {
    if (!eventData || !eventData.serviceId || !eventData.status) return;

    // Update the service in our cached statusData
    if (statusData && statusData.services) {
      for (var i = 0; i < statusData.services.length; i++) {
        if (statusData.services[i].id === eventData.serviceId) {
          statusData.services[i].status = eventData.status;
          break;
        }
      }

      // Recalculate overall status
      var services = statusData.services;
      var allOperational = true;
      var anyMajor = false;
      var anyPartial = false;

      for (var j = 0; j < services.length; j++) {
        if (services[j].status !== 'operational') allOperational = false;
        if (services[j].status === 'major_outage') anyMajor = true;
        if (services[j].status === 'partial_outage') anyPartial = true;
      }

      var overall;
      if (allOperational) overall = 'operational';
      else if (anyMajor) overall = 'major_outage';
      else if (anyPartial) overall = 'partial_outage';
      else overall = 'degraded';

      statusData.status = overall;
      renderOverallStatus(overall);
    }

    // Update the DOM for this specific service
    // Find all service items and update the matching one
    var serviceItems = document.querySelectorAll('.service-item');
    for (var k = 0; k < serviceItems.length; k++) {
      var nameEl = serviceItems[k].querySelector('.service-name');
      if (!nameEl) continue;

      // Match by service name from our cached data
      var matchedService = null;
      if (statusData && statusData.services) {
        for (var m = 0; m < statusData.services.length; m++) {
          if (statusData.services[m].id === eventData.serviceId) {
            matchedService = statusData.services[m];
            break;
          }
        }
      }

      if (matchedService && nameEl.textContent === matchedService.name) {
        var statusDot = serviceItems[k].querySelector('.service-status-dot');
        var statusLabel = serviceItems[k].querySelector('.service-status-label');
        if (statusDot) {
          statusDot.className = 'service-status-dot ' + getStatusColor(eventData.status);
        }
        if (statusLabel) {
          statusLabel.textContent = getStatusLabel(eventData.status);
        }
        break;
      }
    }

    lastFetchTime = new Date();
    updateLastUpdated();
  }

  /**
   * Handle incident SSE events (created, updated, resolved).
   * Triggers a full incident refetch to keep timeline data in sync.
   */
  function handleIncidentEvent(/* eventData */) {
    // Refetch incidents to get complete timeline data
    responseCache.delete(API_INCIDENTS_URL);
    fetchIncidents();
  }

  /**
   * Connect to the SSE event stream.
   * Sets up handlers for all event types and auto-reconnects on failure.
   */
  function connectEventStream() {
    // Check for EventSource support
    if (typeof EventSource === 'undefined') {
      updateSseIndicator(false);
      return;
    }

    // Close any existing connection
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }

    // Clear any pending reconnect
    if (sseReconnectTimer) {
      clearTimeout(sseReconnectTimer);
      sseReconnectTimer = null;
    }

    sseSource = new EventSource(SSE_URL);

    sseSource.onopen = function () {
      updateSseIndicator(true);
      sseReconnectDelay = 1000; // Reset backoff on successful connection
    };

    sseSource.onerror = function () {
      updateSseIndicator(false);

      // EventSource auto-reconnects, but if it's in CLOSED state we do it ourselves
      if (sseSource && sseSource.readyState === EventSource.CLOSED) {
        sseSource.close();
        sseSource = null;
        scheduleReconnect();
      }
    };

    // status.change — update service status in DOM
    sseSource.addEventListener('status.change', function (e) {
      try {
        var data = JSON.parse(e.data);
        handleStatusChange(data);
      } catch (err) {
        // Malformed data — ignore
      }
    });

    // incident.created
    sseSource.addEventListener('incident.created', function (e) {
      try {
        var data = JSON.parse(e.data);
        handleIncidentEvent(data);
      } catch (err) {
        // ignore
      }
    });

    // incident.updated
    sseSource.addEventListener('incident.updated', function (e) {
      try {
        var data = JSON.parse(e.data);
        handleIncidentEvent(data);
      } catch (err) {
        // ignore
      }
    });

    // incident.resolved
    sseSource.addEventListener('incident.resolved', function (e) {
      try {
        var data = JSON.parse(e.data);
        handleIncidentEvent(data);
      } catch (err) {
        // ignore
      }
    });

    // maintenance.started / maintenance.ended — refetch maintenance
    sseSource.addEventListener('maintenance.started', function () {
      responseCache.delete(API_MAINTENANCE_URL);
      fetchMaintenanceWindows();
    });

    sseSource.addEventListener('maintenance.ended', function () {
      responseCache.delete(API_MAINTENANCE_URL);
      fetchMaintenanceWindows();
    });

    // check.completed — could refresh sparklines, but for now just update timestamp
    sseSource.addEventListener('check.completed', function () {
      lastFetchTime = new Date();
      updateLastUpdated();
    });
  }

  /**
   * Schedule an SSE reconnection with exponential backoff.
   * Delays: 1s, 2s, 4s, 8s (capped).
   */
  function scheduleReconnect() {
    if (sseReconnectTimer) return; // already scheduled

    sseReconnectTimer = setTimeout(function () {
      sseReconnectTimer = null;
      connectEventStream();
    }, sseReconnectDelay);

    // Exponential backoff
    sseReconnectDelay = Math.min(sseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY);
  }

  function init() {
    initTheme();

    // Apply branding from server config
    applyBranding();

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

    // Initial data fetch (polling fallback is always active)
    refreshData();

    // Connect SSE event stream for real-time updates
    connectEventStream();
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
