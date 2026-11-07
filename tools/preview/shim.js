// Tauri 兼容垫片：把 window.__TAURI__.core.invoke 映射到预览服务器的 /api/<name>
(function () {
  const call = async (name, args) => {
    const r = await fetch("/api/" + encodeURIComponent(name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || ("调用失败: " + name));
    return j.data;
  };
  window.__TAURI__ = window.__TAURI__ || {};
  window.__TAURI__.core = { invoke: call };
  window.__WORDO_PREVIEW__ = true;
})();
