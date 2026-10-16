(function () {
  var C = window.CONTENT;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var fmt = function (k) { return k.toLocaleString("vi-VN") + ".000đ"; };
  document.documentElement.classList.add("js");

  function ticks(arr) { return '<ul class="ds-tick">' + arr.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>"; }

  // Tính năng
  $("#ds-tinh-nang").innerHTML = C.features.map(function (f) {
    var media = f.queue
      ? '<ul class="khung-media hang-doi" style="align-content:center;padding:16px;display:grid">' + f.queue.map(function (q, i) { return "<li><span>TK " + (i + 1) + " · " + esc(q[0]) + "</span><i>" + esc(q[1]) + "</i></li>"; }).join("") + "</ul>"
      : '<div class="khung-media" role="img" aria-label="' + esc(f.media) + '"><span>' + esc(f.media) + "</span></div>";
    return '<article class="the hien-dan">' + media + "<h3>" + esc(f.title) + "</h3><p>" + esc(f.text) + "</p>" + ticks(f.bullets) + "</article>";
  }).join("");

  // Use case
  $("#ds-ap-dung").innerHTML = C.usecases.map(function (u) {
    return '<article class="the hien-dan"><div class="khung-media doc" role="img" aria-label="' + esc(u.media) + '"><span>' + esc(u.media) + "</span></div><h3>" + esc(u.title) + "</h3><p>" + esc(u.text) + "</p>" + ticks(u.bullets) + "</article>";
  }).join("");

  // So sánh
  $("#ds-so-sanh").innerHTML = C.compare.map(function (c) {
    return '<div class="hang-ss hien-dan' + (c.chinh ? " chinh" : "") + '"><div class="tren"><strong>' + esc(c.name) + '</strong><span class="gia">' + esc(c.price) + "</span></div><small>" + esc(c.note) + '</small><div class="thanh-ti-le" aria-hidden="true"><i data-w="' + c.ti + '"></i></div></div>';
  }).join("");
  $("#chu-thich").textContent = C.compareNote;

  // Bảng giá: tab model + kỳ hạn
  var state = { model: "a", period: 12 };
  var modelBox = $("#chon-model"), periodBox = $("#chon-ky");
  modelBox.innerHTML = Object.keys(C.models).map(function (k) { return '<button type="button" data-k="' + k + '">' + esc(C.models[k].label) + "</button>"; }).join("");
  periodBox.innerHTML = C.periods.map(function (p) { return '<button type="button" data-k="' + p.id + '">' + esc(p.label) + (p.off ? '<span class="giam">' + esc(p.off) + "</span>" : "") + "</button>"; }).join("");

  function renderPricing() {
    Array.prototype.forEach.call(modelBox.children, function (b) { b.setAttribute("aria-pressed", String(b.dataset.k === state.model)); });
    Array.prototype.forEach.call(periodBox.children, function (b) { b.setAttribute("aria-pressed", String(Number(b.dataset.k) === state.period)); });
    $("#mo-ta-model").textContent = C.models[state.model].desc;
    $("#ds-goi").innerHTML = C.plans.map(function (p) {
      var href = "#dang-ky?goi=" + state.model + "-" + p.id + "&ky=" + state.period;
      return '<article class="the the-gia' + (p.hot ? " noi-bat" : "") + '"><div class="ten">' + esc(p.name) + '</div><div class="gia-lon">' + fmt(p.price[state.period]) + "<small> /tháng</small></div>" +
        '<ul class="ds-tick">' + p.bullets.map(function (b) { return '<li class="' + (b[0] ? "" : "khong") + '">' + esc(b[1]) + "</li>"; }).join("") + "</ul>" +
        '<a class="nut ' + (p.hot ? "nut-chinh" : "nut-vien") + '" href="' + href + '">Mua gói này</a></article>';
    }).join("");
    $("#combo-nut").setAttribute("href", "#dang-ky?combo=1&ky=" + state.period);
  }
  modelBox.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { state.model = b.dataset.k; renderPricing(); } });
  periodBox.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { state.period = Number(b.dataset.k); renderPricing(); } });
  $("#combo-off").textContent = C.comboOff;
  renderPricing();

  // Footer
  $("#chan-cot").innerHTML = C.footer.cols.map(function (c) {
    return "<div><h3>" + esc(c[0]) + "</h3><ul>" + c[1].map(function (l) { return '<li><a href="' + esc(l[1]) + '">' + esc(l[0]) + "</a></li>"; }).join("") + "</ul></div>";
  }).join("");
  $("#phap-ly").textContent = C.footer.legal;
  $("#cong-ty").textContent = C.footer.company;

  // Menu mobile
  var nut = $("#menu-nut"), menu = $("#menu-dd");
  nut.addEventListener("click", function () { var m = menu.classList.toggle("mo"); nut.setAttribute("aria-expanded", String(m)); });
  menu.addEventListener("click", function (e) { if (e.target.closest("a")) { menu.classList.remove("mo"); nut.setAttribute("aria-expanded", "false"); } });

  // Hiện dần khi cuộn, có dự phòng 4s để nội dung không bao giờ bị kẹt ẩn
  var reveal = function (el) { el.setAttribute("data-thay", ""); var i = el.querySelector("[data-w]"); if (i) i.style.width = i.dataset.w + "%"; };
  var items = function () { return Array.prototype.slice.call(document.querySelectorAll(".hien-dan:not([data-thay])")); };
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    items().forEach(function (el) { io.observe(el); });
  }
  setTimeout(function () { items().forEach(reveal); }, 4000);
})();
