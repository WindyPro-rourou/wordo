import { chromium } from "playwright-core";
const EDGE="C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const b=await chromium.launch({executablePath:EDGE,headless:true,args:["--no-sandbox"]});
const p=await (await b.newContext({viewport:{width:1440,height:1000},locale:"zh-CN"})).newPage();
const errs=[];p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:4310/",{waitUntil:"networkidle"});
await p.waitForTimeout(1500);
// 切到「今日」
await p.evaluate(()=>document.querySelector('.tab[data-tab="me"]').click());
await p.waitForFunction(()=>document.querySelectorAll(".me-stat").length>0 && document.querySelector(".me-stat .n")?.textContent.trim()!=="…",{timeout:15000});
const info=await p.evaluate(()=>({
  title:document.querySelector(".me h1")?.textContent,
  blocks:[...document.querySelectorAll(".me-block .block-label")].map(x=>x.textContent.trim()),
  hasReportBtn:!!document.querySelector("#me-report"),
}));
// 点导出周报
await p.evaluate(()=>document.querySelector("#me-report").click());
await p.waitForTimeout(2500);
const after=await p.evaluate(()=>({
  msg:document.querySelector(".me-msg")?.textContent?.trim().slice(0,120)||null,
  err:document.querySelector(".me-err")?.textContent?.trim()||null,
}));
await p.screenshot({path:"shots/m9-today.png",fullPage:false});
console.log(JSON.stringify({info,after,errs},null,2));
await b.close();
