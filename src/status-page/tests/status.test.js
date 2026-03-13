/**
 * StatusOwl — Status Page Tests
 * Tests for new features: dark mode, service groups, uptime history, incident badges, auto-refresh
 */

describe('StatusOwl Status Page', function() {
  
  // Helper to create mock DOM elements
  function setupMockDOM() {
    document.body.innerHTML = `
      <div class="container">
        <header class="header">
          <h1 class="logo">StatusOwl 🦉</h1>
          <div class="header-controls">
            <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
              <svg class="sun-icon"></svg>
              <svg class="moon-icon"></svg>
            </button>
            <div class="refresh-timer" id="refresh-timer">
              <span class="refresh-timer-dot"></span>
              <span class="refresh-timer-text">Refreshing in 60s</span>
            </div>
          </div>
        </header>
        <section class="status-banner" id="overall-status">
          <div class="status-indicator">
            <span class="status-dot" id="overall-dot"></span>
            <span class="status-text" id="overall-text">Loading...</span>
          </div>
        </section>
        <section class="services-section">
          <h2>System Status</h2>
          <div class="services-list" id="services-list"></div>
        </section>
        <section class="incidents-section" id="incidents-section">
          <h2>Open Incidents</h2>
          <div class="incidents-list" id="incidents-list"></div>
        </section>
      </div>
    `;
  }
  
  beforeEach(function() {
    setupMockDOM();
    localStorage.clear();
  });
  
  describe('Theme Management', function() {
    it('should have getThemePreference function', function() {
      expect(typeof getThemePreference).toBe('function');
    });
    
    it('should have applyTheme function', function() {
      expect(typeof applyTheme).toBe('function');
    });
    
    it('should have toggleTheme function', function() {
      expect(typeof toggleTheme).toBe('function');
    });
    
    it('should apply light theme by default', function() {
      applyTheme('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
    
    it('should apply dark theme correctly', function() {
      applyTheme('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    
    it('should save theme preference to localStorage', function() {
      applyTheme('dark');
      expect(localStorage.getItem('statusowl-theme')).toBe('dark');
    });
    
    it('should toggle theme correctly', function() {
      applyTheme('light');
      toggleTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      toggleTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
  
  describe('Status Helper Functions', function() {
    it('should return correct color class for operational status', function() {
      expect(getStatusColor('operational')).toBe('operational');
    });
    
    it('should return correct color class for degraded status', function() {
      expect(getStatusColor('degraded')).toBe('degraded');
    });
    
    it('should return correct color class for outage status', function() {
      expect(getStatusColor('outage')).toBe('outage');
      expect(getStatusColor('major_outage')).toBe('outage');
    });
    
    it('should return unknown for unknown status', function() {
      expect(getStatusColor('unknown')).toBe('unknown');
    });
    
    it('should return correct label for operational status', function() {
      expect(getStatusLabel('operational')).toBe('Operational');
    });
    
    it('should return correct label for degraded status', function() {
      expect(getStatusLabel('degraded')).toBe('Degraded');
    });
    
    it('should return correct overall status label', function() {
      expect(getOverallStatusLabel('operational')).toBe('All Systems Operational');
      expect(getOverallStatusLabel('degraded')).toBe('Some Systems Degraded');
      expect(getOverallStatusLabel('major_outage')).toBe('Major Outage');
    });
  });
  
  describe('Service Grouping', function() {
    it('should group services by groupId', function() {
      const services = [
        { id: 1, name: 'Service 1', groupId: 'group-a' },
        { id: 2, name: 'Service 2', groupId: 'group-a' },
        { id: 3, name: 'Service 3', groupId: 'group-b' },
        { id: 4, name: 'Service 4' }
      ];
      
      const { groups, ungrouped } = groupServices(services);
      
      expect(groups['group-a']).toHaveLength(2);
      expect(groups['group-b']).toHaveLength(1);
      expect(ungrouped).toHaveLength(1);
      expect(ungrouped[0].name).toBe('Service 4');
    });
    
    it('should put services without groupId in ungrouped', function() {
      const services = [
        { id: 1, name: 'Service 1' },
        { id: 2, name: 'Service 2' }
      ];
      
      const { groups, ungrouped } = groupServices(services);
      
      expect(Object.keys(groups)).toHaveLength(0);
      expect(ungrouped).toHaveLength(2);
    });
  });
  
  describe('Uptime History Bar', function() {
    it('should render uptime bar with 90 cells', function() {
      const html = renderUptimeBar(null);
      
      // Should contain 90 cells
      const cellCount = (html.match(/uptime-cell/g) || []).length;
      expect(cellCount).toBe(90);
    });
    
    it('should render operational cells for operational days', function() {
      const history = Array(90).fill({ status: 'operational' });
      const html = renderUptimeBar(history);
      
      const operationalCells = (html.match(/operational/g) || []).length;
      expect(operationalCells).toBe(90);
    });
    
    it('should render degraded cells for degraded days', function() {
      const history = Array(90).fill({ status: 'degraded' });
      const html = renderUptimeBar(history);
      
      const degradedCells = (html.match(/degraded/g) || []).length;
      expect(degradedCells).toBe(90);
    });
    
    it('should render outage cells for outage days', function() {
      const history = Array(90).fill({ status: 'outage' });
      const html = renderUptimeBar(history);
      
      const outageCells = (html.match(/outage/g) || []).length;
      expect(outageCells).toBe(90);
    });
    
    it('should render no-data cells for missing days', function() {
      const history = Array(45).fill({ status: 'operational' }).concat(Array(45).fill(null));
      const html = renderUptimeBar(history);
      
      const noDataCells = (html.match(/no-data/g) || []).length;
      expect(noDataCells).toBe(45);
    });
  });
  
  describe('Incident Status Badges', function() {
    it('should return correct badge class for investigating', function() {
      expect(getStatusBadgeClass('investigating')).toBe('investigating');
    });
    
    it('should return correct badge class for identified', function() {
      expect(getStatusBadgeClass('identified')).toBe('identified');
    });
    
    it('should return correct badge class for monitoring', function() {
      expect(getStatusBadgeClass('monitoring')).toBe('monitoring');
    });
    
    it('should return correct badge class for resolved', function() {
      expect(getStatusBadgeClass('resolved')).toBe('resolved');
    });
  });
  
  describe('Auto-refresh Timer', function() {
    it('should have startRefreshTimer function', function() {
      expect(typeof startRefreshTimer).toBe('function');
    });
    
    it('should update timer display', function() {
      startRefreshTimer();
      
      const timerText = document.querySelector('.refresh-timer-text');
      expect(timerText.textContent).toContain('Refreshing in');
      
      // Clean up
      clearInterval(window.countdownInterval);
    });
  });
  
  describe('HTML Escaping', function() {
    it('should escape HTML characters', function() {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('&amp;')).toBe('&amp;amp;');
      expect(escapeHtml('"quotes"')).toBe('&quot;quotes&quot;');
    });
  });
});
