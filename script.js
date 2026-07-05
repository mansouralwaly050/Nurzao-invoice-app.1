/* ============ Storage ============ */
const DB = {
  get invoices(){ return JSON.parse(localStorage.getItem('gen_invoices')||'[]'); },
  set invoices(v){ localStorage.setItem('gen_invoices', JSON.stringify(v)); },
  get settings(){ return JSON.parse(localStorage.getItem('gen_settings')||'{"bizName":"","bizPhone":"","bizLogo":"","invoiceCounter":0,"pinEnabled":false,"pin":"","currency":"SDG","savedItems":[]}'); },
  set settings(v){ localStorage.setItem('gen_settings', JSON.stringify(v)); },
};

let currentItems = [];
let currentCustomer = {name:'', phone:''};
let currentSignature = null;
let reportRange = 'week';
let viewingInvoiceId = null;

/* ============ Utils ============ */
function esc(str){ const d=document.createElement('div'); d.textContent=String(str); return d.innerHTML; }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function fmt(n){ return Number(n||0).toLocaleString('ar-SD'); }
function curr(){ return DB.settings.currency || 'SDG'; }
function syncCurrencyLabels(){
  document.querySelectorAll('.curUnit').forEach(el=> el.textContent = curr());
}
function toast(msg){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),1800);
}
function updateClock(){
  document.getElementById('clock').textContent = new Date().toLocaleString('ar-EG',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
}
setInterval(updateClock,30000); updateClock();

function normalizePhone(phone){
  let p = (phone||'').replace(/\D/g,'');
  if(p.startsWith('0')) p = '249' + p.slice(1);
  else if(p && !p.startsWith('249')) p = '249' + p;
  return p;
}
function shareTextWhatsApp(text, phone){
  try{
    const target = phone ? normalizePhone(phone) : '';
    const url = 'https://wa.me/' + target + '?text=' + encodeURIComponent(text);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }catch(err){
    toast('⚠️ خطأ واتساب: ' + err.message);
  }
}

async function renderToPDF(html, filename){
  const zone = document.getElementById('printzone');
  zone.innerHTML = html;
  const el = zone.firstElementChild;
  const canvas = await html2canvas(el, {scale:2, backgroundColor:'#ffffff'});
  const imgData = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({unit:'pt', format:'a4'});
  const pageWidth = pdf.internal.pageSize.getWidth();
  const imgWidth = pageWidth - 60;
  const imgHeight = canvas.height * (imgWidth / canvas.width);
  pdf.addImage(imgData, 'PNG', 30, 30, imgWidth, imgHeight);
  const pdfBlob = pdf.output('blob');
  const file = new File([pdfBlob], filename, {type:'application/pdf'});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file], title: filename}); zone.innerHTML=''; return 'shared'; }
    catch(err){ /* fall back */ }
  }
  pdf.save(filename);
  zone.innerHTML = '';
  return 'downloaded';
}

/* ============ Navigation ============ */
function switchTab(view){
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  if(view==='invoices') renderInvoiceList();
  if(view==='reports') renderReports();
  if(view==='home') renderHome();
}
document.querySelectorAll('.navbtn').forEach(btn=>{
  btn.addEventListener('click', ()=> switchTab(btn.dataset.view));
});
function goToSettings(){ switchTab('settings'); }

/* ============ Home ============ */
function renderHome(){
  const settings = DB.settings;
  document.getElementById('setupBanner').style.display = settings.bizName ? 'none' : 'block';

  const todayStr = new Date().toDateString();
  const todayInvoices = DB.invoices.filter(i=> new Date(i.date).toDateString()===todayStr);
  document.getElementById('statTodayCount').textContent = todayInvoices.length;
  document.getElementById('statTodayTotal').textContent = fmt(todayInvoices.reduce((s,i)=>s+i.total,0));
}

/* ============ Invoice creation ============ */
function openInvoiceSheet(){
  const settings = DB.settings;
  if(!settings.bizName){ toast('⚠️ أكمل بيانات نشاطك من الإعدادات أولاً'); switchTab('settings'); return; }
  currentItems = [{id:uid(), desc:'', price:'', qty:1}];
  currentCustomer = {name:'', phone:''};
  currentSignature = null;
  viewingInvoiceId = null;
  renderInvoiceCreationSheet();
  document.getElementById('invOverlay').classList.add('show');
}
function closeInvoiceSheet(){ document.getElementById('invOverlay').classList.remove('show'); }

function itemsTotal(items){ return items.reduce((s,it)=> s + (parseFloat(it.price)||0)*(parseFloat(it.qty)||0), 0); }

function renderInvoiceCreationSheet(){
  document.getElementById('invSheetContent').innerHTML = `
    <div class="sheet-handle"></div>
    <h2 class="title">🧾 إنشاء فاتورة</h2>
    <label>اسم العميل</label>
    <input id="custName" placeholder="اسم العميل" value="${esc(currentCustomer.name)}" onchange="currentCustomer.name=this.value">
    <label>رقم الهاتف (اختياري)</label>
    <input id="custPhone" placeholder="09xxxxxxxx" inputmode="tel" value="${esc(currentCustomer.phone)}" onchange="currentCustomer.phone=this.value">
    <label style="margin-top:6px;">البنود / الخدمات</label>
    <div class="chips-row" id="savedItemsChips"></div>
    <div id="itemsBox"></div>
    <button class="btn btn-ghost btn-block" style="margin-bottom:10px;" onclick="addItemRow()">➕ إضافة بند</button>
    <div class="total-line"><span>الإجمالي</span><span id="creationTotal">0 SDG</span></div>
    ${currentSignature ? '<div style="font-size:11.5px;color:var(--palm);margin-bottom:8px;">✅ تم إرفاق توقيع العميل</div>' : ''}
    <button class="btn btn-ghost btn-block" style="margin-bottom:10px;" onclick="openSigSheet()">✍️ ${currentSignature?'تعديل التوقيع':'توقيع العميل (اختياري)'}</button>
    <div class="row">
      <button class="btn btn-ghost btn-block" onclick="saveInvoice(false)">💾 حفظ</button>
      <button class="btn btn-gold btn-block" onclick="saveInvoice(true)">📄 حفظ وتصدير PDF</button>
    </div>
    <button class="btn btn-palm btn-block" style="margin-top:8px;" onclick="saveInvoice('whatsapp')">📲 حفظ وإرسال عبر واتساب</button>
    <button class="btn btn-ghost btn-block" style="margin-top:8px;" onclick="closeInvoiceSheet()">إلغاء</button>
  `;
  renderItemsBox();
  renderSavedItemsChips();
}
function renderSavedItemsChips(){
  const box = document.getElementById('savedItemsChips');
  const saved = DB.settings.savedItems || [];
  if(saved.length===0){ box.innerHTML=''; return; }
  box.innerHTML = saved.map((s,i)=>`<span class="chip" onclick="quickAddSavedItem(${i})">⚡ ${esc(s.desc)} · ${fmt(s.price)}</span>`).join('');
}
function quickAddSavedItem(i){
  const saved = DB.settings.savedItems || [];
  const s = saved[i];
  if(!s) return;
  // fill the last empty row if present, else add a new row
  const emptyIdx = currentItems.findIndex(it=> !it.desc.trim());
  if(emptyIdx>-1){ currentItems[emptyIdx] = {id:uid(), desc:s.desc, price:s.price, qty:1}; }
  else{ currentItems.push({id:uid(), desc:s.desc, price:s.price, qty:1}); }
  renderItemsBox();
}
function saveItemsToCatalog(items){
  let saved = DB.settings.savedItems || [];
  items.forEach(it=>{
    const idx = saved.findIndex(s=> s.desc.toLowerCase()===it.desc.toLowerCase());
    if(idx>-1) saved[idx] = {desc:it.desc, price:it.price};
    else saved.unshift({desc:it.desc, price:it.price});
  });
  saved = saved.slice(0,20);
  DB.settings = {...DB.settings, savedItems:saved};
}
function renderItemsBox(){
  const box = document.getElementById('itemsBox');
  box.innerHTML = currentItems.map((it,i)=>`
    <div class="item-row">
      <input placeholder="${i===0?'مثال: صيانة مكيف':'اسم الخدمة أو المنتج'}" value="${esc(it.desc)}" onchange="currentItems[${i}].desc=this.value">
      <div class="row">
        <input type="number" inputmode="decimal" placeholder="السعر" value="${it.price}" oninput="currentItems[${i}].price=this.value; updateCreationTotal();">
        <input type="number" inputmode="decimal" placeholder="الكمية" value="${it.qty}" oninput="currentItems[${i}].qty=this.value; updateCreationTotal();">
      </div>
      <div class="rowtotal">
        <span>الإجمالي: ${fmt((parseFloat(it.price)||0)*(parseFloat(it.qty)||0))} ${curr()}</span>
        ${currentItems.length>1 ? `<button class="btn btn-danger btn-sm" onclick="removeItemRow(${i})">🗑️ حذف</button>` : ''}
      </div>
    </div>
  `).join('');
  updateCreationTotal();
}
function addItemRow(){ currentItems.push({id:uid(), desc:'', price:'', qty:1}); renderItemsBox(); }
function removeItemRow(i){ currentItems.splice(i,1); renderItemsBox(); }
function updateCreationTotal(){
  document.getElementById('creationTotal').textContent = fmt(itemsTotal(currentItems)) + ' ' + curr();
}

/* ============ Signature pad ============ */
let sigCtx, sigDrawing=false;
function openSigSheet(){
  document.getElementById('sigOverlay').classList.add('show');
  setTimeout(()=>{
    const canvas = document.getElementById('sigCanvas');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    sigCtx = canvas.getContext('2d');
    sigCtx.lineWidth = 2.2; sigCtx.lineCap='round'; sigCtx.strokeStyle='#111';
    if(currentSignature){
      const img = new Image();
      img.onload = ()=> sigCtx.drawImage(img,0,0,canvas.width,canvas.height);
      img.src = currentSignature;
    }
    canvas.onpointerdown = e=>{ sigDrawing=true; sigCtx.beginPath(); sigCtx.moveTo(e.offsetX,e.offsetY); };
    canvas.onpointermove = e=>{ if(sigDrawing){ sigCtx.lineTo(e.offsetX,e.offsetY); sigCtx.stroke(); } };
    canvas.onpointerup = ()=> sigDrawing=false;
    canvas.onpointerleave = ()=> sigDrawing=false;
  }, 50);
}
function closeSigSheet(){ document.getElementById('sigOverlay').classList.remove('show'); }
function clearSignature(){
  const canvas = document.getElementById('sigCanvas');
  sigCtx.clearRect(0,0,canvas.width,canvas.height);
}
function saveSignature(){
  const canvas = document.getElementById('sigCanvas');
  currentSignature = canvas.toDataURL('image/png');
  closeSigSheet();
  renderInvoiceCreationSheet();
  toast('✅ تم حفظ التوقيع');
}

/* ============ Save invoice ============ */
function nextInvoiceNumber(){
  const settings = DB.settings;
  const next = (settings.invoiceCounter||0) + 1;
  DB.settings = {...settings, invoiceCounter: next};
  return next;
}
function saveInvoice(withPdf){
  const name = document.getElementById('custName').value.trim();
  const validItems = currentItems.filter(it=> it.desc.trim() && parseFloat(it.price)>0 && parseFloat(it.qty)>0);
  if(!name){ toast('⚠️ أدخل اسم العميل'); return; }
  if(validItems.length===0){ toast('⚠️ أضف بند واحد على الأقل بسعر وكمية صحيحين'); return; }

  const invoice = {
    id: uid(),
    invoiceNo: nextInvoiceNumber(),
    date: new Date().toISOString(),
    customerName: name,
    customerPhone: currentCustomer.phone,
    items: validItems.map(it=>({desc:it.desc, price:parseFloat(it.price), qty:parseFloat(it.qty)})),
    total: itemsTotal(validItems),
    signature: currentSignature
  };
  const invoices = DB.invoices; invoices.push(invoice); DB.invoices = invoices;
  saveItemsToCatalog(invoice.items);

  closeInvoiceSheet();
  renderHome();
  toast('✅ تم حفظ الفاتورة رقم #' + invoice.invoiceNo);

  if(withPdf===true) exportInvoicePDF(invoice.id);
  if(withPdf==='whatsapp') sendInvoiceWhatsAppText(invoice.id);
}

/* ============ Invoice list ============ */
function renderInvoiceList(){
  const q = (document.getElementById('searchInv').value||'').trim().toLowerCase();
  let invoices = DB.invoices.slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
  if(q) invoices = invoices.filter(i=>
    String(i.invoiceNo).includes(q) || i.customerName.toLowerCase().includes(q) || (i.customerPhone||'').includes(q)
  );
  const box = document.getElementById('invoiceList');
  if(invoices.length===0){ box.innerHTML = '<div class="empty">لا توجد فواتير بعد</div>'; return; }
  box.innerHTML = invoices.map(i=>`
    <div class="inv-item" onclick="openInvoiceDetail('${i.id}')">
      <div>
        <div class="iname">#${i.invoiceNo} · ${esc(i.customerName)}</div>
        <div class="imeta">${new Date(i.date).toLocaleString('ar-EG')}</div>
      </div>
      <div class="itotal">${fmt(i.total)} ${curr()}</div>
    </div>
  `).join('');
}

function openInvoiceDetail(invoiceId){
  const inv = DB.invoices.find(i=>i.id===invoiceId);
  if(!inv) return;
  viewingInvoiceId = invoiceId;
  const rows = inv.items.map(it=>`
    <tr><td>${esc(it.desc)}</td><td>${it.qty}</td><td>${fmt(it.price)}</td><td>${fmt(it.price*it.qty)}</td></tr>
  `).join('');
  document.getElementById('invSheetContent').innerHTML = `
    <div class="sheet-handle"></div>
    <h2 class="title">🧾 فاتورة #${inv.invoiceNo}</h2>
    <div class="card">
      <div style="font-size:13px;"><b>${esc(inv.customerName)}</b> ${inv.customerPhone ? '· '+esc(inv.customerPhone):''}</div>
      <div style="font-size:11.5px; color:var(--muted); margin-bottom:10px;">${new Date(inv.date).toLocaleString('ar-EG')}</div>
      <table class="rep" style="width:100%; border-collapse:collapse; font-size:12px;">
        <tr><th style="text-align:right; color:var(--muted); padding:6px 4px; border-bottom:1px solid var(--line);">البند</th><th style="color:var(--muted); padding:6px 4px; border-bottom:1px solid var(--line);">كمية</th><th style="color:var(--muted); padding:6px 4px; border-bottom:1px solid var(--line);">سعر</th><th style="color:var(--muted); padding:6px 4px; border-bottom:1px solid var(--line);">مجموع</th></tr>
        ${rows}
      </table>
      <div class="total-line"><span>الإجمالي</span><span>${fmt(inv.total)} ${curr()}</span></div>
    </div>
    <button class="btn btn-gold btn-block" style="margin-bottom:8px;" onclick="exportInvoicePDF('${inv.id}')">📄 تصدير / مشاركة PDF</button>
    <button class="btn btn-palm btn-block" style="margin-bottom:8px;" onclick="sendInvoiceWhatsAppText('${inv.id}')">📲 إرسال نص الفاتورة عبر واتساب</button>
    <button class="btn btn-ghost btn-block" style="margin-bottom:8px;" onclick="duplicateInvoice('${inv.id}')">🔁 تكرار هذه الفاتورة</button>
    <button class="btn btn-ghost btn-block" style="margin-bottom:8px;" onclick="printInvoice('${inv.id}')">🖨️ طباعة</button>
    <button class="btn btn-danger btn-block" style="margin-bottom:8px;" onclick="deleteInvoice('${inv.id}')">🗑️ حذف الفاتورة</button>
    <button class="btn btn-ghost btn-block" onclick="closeInvoiceSheet()">إغلاق</button>
  `;
  document.getElementById('invOverlay').classList.add('show');
}
function duplicateInvoice(invoiceId){
  const inv = DB.invoices.find(i=>i.id===invoiceId);
  if(!inv) return;
  currentItems = inv.items.map(it=>({id:uid(), desc:it.desc, price:it.price, qty:it.qty}));
  currentCustomer = {name:inv.customerName, phone:inv.customerPhone||''};
  currentSignature = null;
  viewingInvoiceId = null;
  closeInvoiceSheet();
  setTimeout(()=>{
    renderInvoiceCreationSheet();
    document.getElementById('invOverlay').classList.add('show');
    toast('🔁 جاهز لإنشاء فاتورة جديدة بنفس البيانات');
  }, 200);
}

function deleteInvoice(invoiceId){
  if(!confirm('حذف هذه الفاتورة نهائياً؟')) return;
  DB.invoices = DB.invoices.filter(i=>i.id!==invoiceId);
  closeInvoiceSheet();
  renderInvoiceList();
  renderHome();
  toast('🗑️ تم الحذف');
}

/* ============ PDF export with logo + QR + signature ============ */
async function buildInvoiceHTML(inv){
  const settings = DB.settings;
  const logoHtml = settings.bizLogo ? `<img src="${settings.bizLogo}">` : '';
  const rows = inv.items.map(it=>`
    <tr><td>${esc(it.desc)}</td><td>${it.qty}</td><td>${fmt(it.price)}</td><td>${fmt(it.price*it.qty)}</td></tr>
  `).join('');
  const sigHtml = inv.signature ? `<img src="${inv.signature}">` : '<span style="color:#999;font-size:11px;">بدون توقيع</span>';

  // Generate QR into a temp container, then read its image/canvas
  const qrText = `فاتورة #${inv.invoiceNo} | ${inv.customerName} | ${fmt(inv.total)} ${curr()} | ${new Date(inv.date).toLocaleDateString('ar-EG')}`;
  const qrHolder = document.getElementById('qrTemp');
  qrHolder.innerHTML = '';
  new QRCode(qrHolder, {text: qrText, width:100, height:100});
  await new Promise(r=>setTimeout(r,120));
  let qrImgHtml = '';
  const qrCanvas = qrHolder.querySelector('canvas');
  const qrImg = qrHolder.querySelector('img');
  if(qrCanvas) qrImgHtml = `<img src="${qrCanvas.toDataURL('image/png')}" width="90" height="90">`;
  else if(qrImg) qrImgHtml = `<img src="${qrImg.src}" width="90" height="90">`;

  return `
    <div class="inv">
      <div class="invhead">
        ${logoHtml}
        <div>
          <h2>${esc(settings.bizName || 'فاتورة')}</h2>
          <div class="sub" style="margin-bottom:0;">${settings.bizPhone ? esc(settings.bizPhone) : ''}</div>
        </div>
      </div>
      <div class="sub">فاتورة رقم #${inv.invoiceNo} · ${new Date(inv.date).toLocaleString('ar-EG')}</div>
      <div class="sub">العميل: ${esc(inv.customerName)} ${inv.customerPhone ? '· '+esc(inv.customerPhone) : ''}</div>
      <table>
        <thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="grand">الإجمالي: ${fmt(inv.total)} ${curr()}</div>
      <div class="sigblock">
        <div>${sigHtml}<div style="font-size:10px;color:#777;margin-top:2px;">توقيع العميل</div></div>
        <div class="qrblock">${qrImgHtml}<div style="font-size:10px;color:#777;">امسح للتحقق من بيانات الفاتورة</div></div>
      </div>
      <div class="footline">تم الإنشاء عبر تطبيق فواتير سريعة</div>
    </div>
  `;
}

async function exportInvoicePDF(invoiceId){
  const inv = DB.invoices.find(i=>i.id===invoiceId);
  if(!inv) return;
  const html = await buildInvoiceHTML(inv);
  const result = await renderToPDF(html, `فاتورة-${inv.invoiceNo}.pdf`);
  toast(result==='shared' ? '✅ تم فتح خيارات المشاركة' : '✅ تم تحميل الفاتورة');
}

function sendInvoiceWhatsAppText(invoiceId){
  try{
    const inv = DB.invoices.find(i=>i.id===invoiceId);
    if(!inv){ toast('⚠️ لم يتم العثور على الفاتورة'); return; }
    const settings = DB.settings;
    let text = `🧾 ${settings.bizName || ''}\nفاتورة رقم #${inv.invoiceNo}\nالعميل: ${inv.customerName}\n-----------------\n`;
    inv.items.forEach(it=>{ text += `${it.desc} × ${it.qty} = ${fmt(it.price*it.qty)} ${curr()}\n`; });
    text += `-----------------\nالإجمالي: ${fmt(inv.total)} ${curr()}`;
    shareTextWhatsApp(text, inv.customerPhone);
  }catch(err){
    toast('⚠️ خطأ: ' + err.message);
  }
}

async function printInvoice(invoiceId){
  const inv = DB.invoices.find(i=>i.id===invoiceId);
  if(!inv) return;
  const html = await buildInvoiceHTML(inv);
  let area = document.getElementById('printArea');
  if(!area){ area = document.createElement('div'); area.id='printArea'; document.body.appendChild(area); }
  area.innerHTML = html;
  window.print();
}

/* ============ Reports ============ */
document.getElementById('repFilter').addEventListener('click', e=>{
  if(e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#repFilter button').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  reportRange = e.target.dataset.r;
  renderReports();
});
function invoicesInRange(range){
  const now = new Date();
  let start;
  if(range==='today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if(range==='week'){ start = new Date(now); start.setDate(now.getDate()-7); }
  else if(range==='month'){ start = new Date(now); start.setMonth(now.getMonth()-1); }
  else start = new Date(2000,0,1);
  return DB.invoices.filter(i=> new Date(i.date) >= start);
}
function renderReports(){
  const invoices = invoicesInRange(reportRange);
  const total = invoices.reduce((s,i)=>s+i.total,0);
  const avg = invoices.length ? Math.round(total/invoices.length) : 0;
  document.getElementById('repCount').textContent = invoices.length;
  document.getElementById('repTotal').textContent = fmt(total);
  document.getElementById('repAvg').textContent = fmt(avg);
}

/* ============ Settings ============ */
function handleLogoUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    const settings = DB.settings;
    DB.settings = {...settings, bizLogo: ev.target.result};
    renderLogoPreview();
    toast('✅ تم رفع الشعار');
  };
  reader.readAsDataURL(file);
}
function removeLogo(){
  const settings = DB.settings;
  DB.settings = {...settings, bizLogo:''};
  renderLogoPreview();
  toast('🗑️ تم إزالة الشعار');
}
function renderLogoPreview(){
  const settings = DB.settings;
  const preview = document.getElementById('logoPreview');
  const badge = document.getElementById('headerBadge');
  if(settings.bizLogo){
    preview.innerHTML = `<img src="${settings.bizLogo}">`;
    badge.innerHTML = `<img src="${settings.bizLogo}">`;
  } else {
    preview.innerHTML = '🧾';
    badge.innerHTML = '🧾';
  }
}
function saveSettings(){
  const name = document.getElementById('setBizName').value.trim();
  const phone = document.getElementById('setBizPhone').value.trim();
  const currency = document.getElementById('setCurrency').value.trim() || 'SDG';
  if(!name){ toast('⚠️ أدخل اسم النشاط'); return; }
  const settings = DB.settings;
  DB.settings = {...settings, bizName:name, bizPhone:phone, currency};
  document.getElementById('bizName').textContent = name;
  syncCurrencyLabels();
  renderHome();
  renderReports();
  toast('✅ تم الحفظ');
}
function exportBackup(){
  const backup = {invoices:DB.invoices, settings:DB.settings};
  const blob = new Blob([JSON.stringify(backup,null,2)], {type:'application/json'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'invoice-app-backup.json';
  link.click();
}
function importBackup(){
  const file = document.getElementById('importFile').files[0];
  if(!file){ toast('⚠️ اختر ملف النسخة الاحتياطية'); return; }
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const data = JSON.parse(e.target.result);
      if(data.invoices) DB.invoices = data.invoices;
      if(data.settings) DB.settings = data.settings;
      initApp();
      toast('✅ تم الاستيراد بنجاح');
    }catch(err){ toast('⚠️ ملف غير صالح'); }
  };
  reader.readAsText(file);
}
function resetAll(){
  if(!confirm('سيتم حذف جميع الفواتير وبيانات النشاط نهائياً. هل أنت متأكد؟')) return;
  if(!confirm('تأكيد أخير: هذا الإجراء لا يمكن التراجع عنه!')) return;
  localStorage.removeItem('gen_invoices');
  localStorage.removeItem('gen_settings');
  initApp();
  toast('🗑️ تم حذف جميع البيانات');
}

/* ============ PIN lock ============ */
let pinBuffer = '';
let pinSetupStage = null; // null | 'new' | 'confirm'
let pinFirstEntry = '';

function renderPinDots(){
  const dots = document.querySelectorAll('#pinDots span');
  dots.forEach((d,i)=> d.classList.toggle('filled', i < pinBuffer.length));
}
function pinPress(digit){
  if(pinBuffer.length>=4) return;
  pinBuffer += digit;
  renderPinDots();
  if(pinBuffer.length===4) setTimeout(handlePinComplete, 150);
}
function pinBackspace(){
  pinBuffer = pinBuffer.slice(0,-1);
  renderPinDots();
  document.getElementById('lockError').textContent='';
}
function shakeDots(){
  const dots = document.getElementById('pinDots');
  dots.classList.add('shake');
  setTimeout(()=>dots.classList.remove('shake'), 350);
}
function handlePinComplete(){
  const settings = DB.settings;
  if(pinSetupStage==='new'){
    pinFirstEntry = pinBuffer;
    pinBuffer=''; renderPinDots();
    document.getElementById('lockError').textContent='';
    document.querySelector('.locksub').textContent = 'أعد إدخال الرمز للتأكيد';
    pinSetupStage='confirm';
    return;
  }
  if(pinSetupStage==='confirm'){
    if(pinBuffer===pinFirstEntry){
      DB.settings = {...DB.settings, pinEnabled:true, pin:pinBuffer};
      exitLockScreen();
      toast('✅ تم تفعيل قفل PIN');
      renderPinSettingsStatus();
    } else {
      shakeDots();
      document.getElementById('lockError').textContent='الرمزين غير متطابقين، حاول مرة أخرى';
      pinBuffer=''; pinFirstEntry=''; pinSetupStage='new'; renderPinDots();
      document.querySelector('.locksub').textContent = 'أدخل رمز PIN جديد (٤ أرقام)';
    }
    return;
  }
  // verifying to unlock
  if(pinBuffer===settings.pin){
    exitLockScreen();
  } else {
    shakeDots();
    document.getElementById('lockError').textContent='رمز غير صحيح';
    pinBuffer=''; renderPinDots();
  }
}
function showLockScreen(mode){
  const settings = DB.settings;
  document.getElementById('lockBizName').textContent = settings.bizName || 'فواتير سريعة';
  document.getElementById('lockBadge').innerHTML = settings.bizLogo ? `<img src="${settings.bizLogo}">` : '🧾';
  document.querySelector('.locksub').textContent = mode==='setup' ? 'أدخل رمز PIN جديد (٤ أرقام)' : 'أدخل رمز PIN لفتح التطبيق';
  document.getElementById('lockError').textContent='';
  pinBuffer=''; pinFirstEntry='';
  pinSetupStage = mode==='setup' ? 'new' : null;
  renderPinDots();
  document.getElementById('lockScreen').classList.add('show');
}
function exitLockScreen(){
  document.getElementById('lockScreen').classList.remove('show');
  pinBuffer=''; pinSetupStage=null;
  startApp();
}
function togglePinSetup(){
  const settings = DB.settings;
  if(settings.pinEnabled){
    if(!confirm('هل تريد إيقاف قفل PIN؟')) return;
    DB.settings = {...settings, pinEnabled:false, pin:''};
    renderPinSettingsStatus();
    toast('🔓 تم إيقاف قفل PIN');
  } else {
    showLockScreen('setup');
  }
}
function renderPinSettingsStatus(){
  const settings = DB.settings;
  document.getElementById('pinStatusBox').textContent = settings.pinEnabled ? '🔒 القفل مفعّل حاليًا' : '🔓 القفل غير مفعّل — التطبيق مفتوح مباشرة';
  document.getElementById('pinToggleBtn').textContent = settings.pinEnabled ? 'إيقاف قفل PIN' : 'تفعيل قفل PIN';
}

/* ============ Init ============ */
function initApp(){
  const settings = DB.settings;
  if(settings.pinEnabled && settings.pin){
    showLockScreen('unlock');
  } else {
    startApp();
  }
}
function startApp(){
  const settings = DB.settings;
  document.getElementById('bizName').textContent = settings.bizName || 'فواتير سريعة';
  document.getElementById('setBizName').value = settings.bizName || '';
  document.getElementById('setBizPhone').value = settings.bizPhone || '';
  document.getElementById('setCurrency').value = settings.currency || 'SDG';
  syncCurrencyLabels();
  renderLogoPreview();
  renderPinSettingsStatus();
  renderHome();
  renderReports();
}
initApp();