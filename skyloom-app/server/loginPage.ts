/** The login page is static and has no inline script or style, so the strict CSP can stay on. */
export const LOGIN_HTML = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><title>Skyloom · Đăng nhập</title><link rel="stylesheet" href="/login.css"></head>
<body><main class="box"><img class="mark" src="/logo-mark.svg" alt="" width="56" height="56"><h1>Skyloom</h1><p class="sub">Đăng nhập để tiếp tục</p>
<form id="f" autocomplete="on"><label for="u">Tên đăng nhập</label><input id="u" name="username" autocomplete="username" required autofocus>
<label for="p">Mật khẩu</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Đăng nhập</button><div id="msg" role="alert" aria-live="polite"></div></form></main><script src="/login.js"></script></body></html>`;

export const LOGIN_CSS = `:root{--bg:#060914;--surface:#0f1324;--ink:#fff;--ink2:#c5c9e0;--line:#ffffff24;--btn:#6a58f0;--bad:#ff8a8a}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font-family:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif}
.box{width:min(380px,92vw);background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{margin:0 0 4px;font-size:1.5rem}.mark{display:block;margin:0 0 14px;border-radius:14px}.sub{margin:0 0 18px;color:var(--ink2)}
label{display:block;font-size:.85rem;color:var(--ink2);margin:12px 0 4px}
input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:#171c33;color:inherit;font:inherit}
input:focus,button:focus-visible{outline:2px solid #8be9ff;outline-offset:1px}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:999px;background:var(--btn);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}#msg{min-height:1.4em;margin-top:12px;color:var(--bad);font-size:.9rem}`;

export const LOGIN_JS = `const f=document.getElementById('f'),m=document.getElementById('msg'),b=f.querySelector('button');
f.addEventListener('submit',async(e)=>{e.preventDefault();m.textContent='';b.disabled=true;
try{const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'skyloom'},
body:JSON.stringify({user:f.username.value,password:f.password.value})});
if(r.ok){location.replace('/');return}
m.textContent=r.status===429?'Sai quá nhiều lần. Hãy thử lại sau ít phút.':'Sai tên đăng nhập hoặc mật khẩu.'}
catch{m.textContent='Không kết nối được máy chủ.'}
b.disabled=false;f.password.value=''});`;
