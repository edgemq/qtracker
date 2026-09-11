// Main Application Entry & Tab Navigation
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Modules
  CatalogModule.init();
  DownloadsModule.init();
  SettingsModule.init();
  UpdaterModule.init();

  // Tab Navigation Handling
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.content-view');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.dataset.tab;

      // Update Nav Buttons
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');

      // Switch View
      views.forEach(view => {
        if (view.id === `view-${targetTab}`) {
          view.classList.add('active');
        } else {
          view.classList.remove('active');
        }
      });
    });
  });

  // Check initial RuTracker auth status in background
  window.qtracker.checkAuth().catch(() => {});
});
