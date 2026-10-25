/* Dashboard bootstrap. The URL (/dashboard/<portal>) decides which portal shell is started:
 *   customer  -> fixed navigation (pages-customer.js)
 *   staff / admin / platform -> navigation + tables come from /api/meta (pages-hotel.js builds the pages) */
(function () {
  'use strict';
  var IS = window.IS, m = location.pathname.match(/\/dashboard\/(customer|staff|admin|platform)/);
  var portal = m ? m[1] : 'customer';
  document.getElementById('app').firstChild.appendChild(IS.loading(6));
  var SUB = { customer: 'Guest Portal', staff: 'Staff Portal', admin: 'Hotel Admin', platform: 'Platform Admin' };

  if (portal === 'customer') {
    IS.portal.start({ portal: 'customer', subtitle: SUB.customer, title: 'My InnovaStay', home: 'overview', profilePage: 'profile', nav: IS.customerNav });
    return;
  }
  IS.get('/api/meta', null, { noRedirect: true }).then(function (meta) {
    var nav = [];
    meta.nav.forEach(function (sec) {
      sec.items.forEach(function (it) { nav.push({ id: it.key, label: it.label, icon: it.icon, group: sec.section }); });
    });
    IS.hotel.registerPages(meta);
    IS.pages.overview = IS.hotel.overviewPage;
    IS.portal.start({ portal: portal, subtitle: SUB[portal], title: meta.user.hotel, home: 'overview', search: portal !== 'platform', nav: nav });
  }, function (e) {
    if (e.status === 401 || e.status === 403) location.replace('/login.html?portal=' + portal);
    else { var a = document.getElementById('app'); IS.clear(a); a.appendChild(IS.errorBox(e)); }
  });
})();
