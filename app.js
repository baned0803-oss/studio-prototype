// --------- 設定: Airtable 公開ビューの CSV URL をここに入れてください ----------
const AIRTABLE_CSV_URL = 'https://airtable.com/v0.3/view/viwOkF1Ao21XvXR6W/downloadCsv?x-time-zone=Asia%2FTokyo&x-user-locale=en&x-airtable-application-id=appb4vQbOqK7XyX22&stringifiedObjectParams=%7B%22origin%22%3A%22viewMenuPopover%22%7D&requestId=reqINtcmXtS7fVQY2&accessPolicy=%7B%22allowedActions%22%3A%5B%7B%22modelClassName%22%3A%22view%22%2C%22modelIdSelector%22%3A%22viwOkF1Ao21XvXR6W%22%2C%22action%22%3A%22readSharedViewData%22%7D%2C%7B%22modelClassName%22%3A%22view%22%2C%22modelIdSelector%22%3A%22viwOkF1Ao21XvXR6W%22%2C%22action%22%3A%22getMetadataForPrinting%22%7D%2C%7B%22modelClassName%22%3A%22view%22%2C%22modelIdSelector%22%3A%22viwOkF1Ao21XvXR6W%22%2C%22action%22%3A%22readSignedAttachmentUrls%22%7D%2C%7B%22modelClassName%22%3A%22row%22%2C%22modelIdSelector%22%3A%22rows%20*%5BdisplayedInView%3DviwOkF1Ao21XvXR6W%5D%22%2C%22action%22%3A%22createDocumentPreviewSession%22%7D%2C%7B%22modelClassName%22%3A%22view%22%2C%22modelIdSelector%22%3A%22viwOkF1Ao21XvXR6W%22%2C%22action%22%3A%22downloadCsv%22%7D%2C%7B%22modelClassName%22%3A%22view%22%2C%22modelIdSelector%22%3A%22viwOkF1Ao21XvXR6W%22%2C%22action%22%3A%22downloadICal%22%7D%2C%7B%22modelClassName%22%3A%22row%22%2C%22modelIdSelector%22%3A%22rows%20*%5BdisplayedInView%3DviwOkF1Ao21XvXR6W%5D%22%2C%22action%22%3A%22downloadAttachment%22%7D%5D%2C%22shareId%22%3A%22shrI0AkZ4rnWMJpaB%22%2C%22applicationId%22%3A%22appb4vQbOqK7XyX22%22%2C%22generationNumber%22%3A0%2C%22expires%22%3A%222025-11-20T00%3A00%3A00.000Z%22%2C%22signature%22%3A%22a7ec0a3c21a4a083c97e4ceca173f060fe6f1c87d20c4ae5575150f812465bae%22%7D'
// localStorageキー
const LSKEY = 'studio_search_conditions_v1';

// ヘルパー: "HH:MM" => minutes
function toMinutes(hhmm){
    if(!hhmm) return null;
    const [h,m] = hhmm.split(':').map(Number);
    return h*60 + m;
}

// エスケープ（簡易）
function escapeHtml(s){ return String(s || '').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>'); }
function escapeAttr(s){ return String(s || '').replace(/"/g,'"'); }

// 要素取得
const timeInput = document.getElementById('timeInput');
const priceInput = document.getElementById('priceInput');
const peopleInput = document.getElementById('peopleInput');
const searchBtn = document.getElementById('searchBtn');
const result = document.getElementById('result');

// 初期値復元
const saved = JSON.parse(localStorage.getItem(LSKEY) || '{}');
if(saved.time) timeInput.value = saved.time;
if(saved.price) priceInput.value = saved.price;
if(saved.people) peopleInput.value = saved.people;

// レンダリング
function renderCards(items){
    result.innerHTML = '';
    if(items.length === 0){
        result.innerHTML = '<p>該当するスタジオは見つかりませんでした。</p>';
        return;
    }
    items.forEach(it=>{
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = '<h3>' + escapeHtml(it.studio_name) + ' - ' + escapeHtml(it.room_name) + '</h3>' +
            '<div class="meta">料金: ' + (it.rate.min_price ?? '-') + '円 ('+ escapeHtml(it.rate.rate_name || '') +')' +
            ' / 推奨最大: ' + (it.room.recommended_max ?? '-') + '人' +
            ' / 1人あたり: ' + (it.cost_per_person ? Math.round(it.cost_per_person) + '円' : '-') +
            '</div>' +
            '<p style="margin-top:8px;"><a href="'+escapeAttr(it.studio_url || '#')+'" target="_blank"><button>この部屋を予約する</button></a></p>';
        result.appendChild(div);
    });
}

// 検索処理（studios構造が必要）
function runSearch(studios){
    function search(){
        const st = timeInput.value;
        const maxPrice = priceInput.value ? Number(priceInput.value) : Infinity;
        const minPeople = peopleInput.value ? Number(peopleInput.value) : 0;
        localStorage.setItem(LSKEY, JSON.stringify({time:st, price: priceInput.value, people: peopleInput.value}));
        const tmin = toMinutes(st);
        const results = [];

        studios.forEach(studio=>{
            (studio.rooms || []).forEach(room=>{
                (room.rates || []).forEach(rate=>{
                    const s = toMinutes(rate.start_time);
                    const e = toMinutes(rate.end_time);
                    if(tmin === null) return;
                    if(!(s <= tmin && tmin < e)) return;
                    if(rate.min_price != null && rate.min_price > maxPrice) return;
                    if(room.recommended_max != null && room.recommended_max < minPeople) return;
                    const cost_per_person = (rate.min_price && room.recommended_max) ? rate.min_price / room.recommended_max : null;
                    results.push({
                        studio_name: studio.studio_name,
                        studio_url: studio.official_url,
                        room_name: room.room_name,
                        room: room,
                        rate: rate,
                        cost_per_person: cost_per_person
                    });
                });
            });
        });

        results.sort((a,b)=>(a.cost_per_person ?? Infinity) - (b.cost_per_person ?? Infinity));
        renderCards(results);
    }

    searchBtn.addEventListener('click', search);
    [timeInput, priceInput, peopleInput].forEach(inp=>{
        inp.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') search(); });
    });
}

// CSVを取得して解析（PapaParseを利用）
async function fetchCsvToStudios(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error('CSV fetch failed: '+res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data; // 配列のオブジェクト（ヘッダ→値）

    // 想定CSVカラム（AirtableのViewで合わせてください）
    // studio_id, studio_name, studio_url, room_id, room_name, recommended_max, rate_id, rate_name, start_time, end_time, min_price
    const studiosMap = {};
    rows.forEach(r=>{
        const sid = (r.studio_id || r.studio_name || '').toString().trim();
        if(!sid) return;
        if(!studiosMap[sid]) studiosMap[sid] = { id: sid, studio_name: (r.studio_name||'').trim(), official_url: (r.studio_url||'').trim(), rooms: {} };
        const s = studiosMap[sid];
        const rid = (r.room_id || r.room_name || '').toString().trim();
        if(!rid) return;
        if(!s.rooms[rid]) s.rooms[rid] = { id: rid, room_name: (r.room_name||'').trim(), recommended_max: r.recommended_max ? Number(r.recommended_max) : null, rates: [] };
        const rate = {
            id: (r.rate_id||'').toString().trim(),
            rate_name: (r.rate_name||'').trim(),
            start_time: (r.start_time||'').trim(),
            end_time: (r.end_time||'').trim(),
            min_price: r.min_price ? Number(r.min_price) : null
        };
        s.rooms[rid].rates.push(rate);
    });

    return Object.values(studiosMap).map(s=>({ id: s.id, studio_name: s.studio_name, official_url: s.official_url, rooms: Object.values(s.rooms) }));
}

// data.json から読み込むフォールバック（CSV未設定時の動作確認用）
async function fetchLocalJson(){
    const res = await fetch('data.json');
    if(!res.ok) throw new Error('data.json fetch failed: '+res.status);
    return await res.json();
}

// ==========================================================
// ⬇️ 既存のコードの末尾（メイン処理部分）を以下のコードに置き換えてください ⬇️
// ==========================================================

// メイン処理：CSV優先、なければ local JSON
async function initializeApp(){
    try{
        let studios;
        if(AIRTABLE_CSV_URL && AIRTABLE_CSV_URL.trim() !== ''){
            // ログの追加：ここが成功すればデータ取得成功
            console.log('Airtable CSVからのデータ取得を開始します...');
            studios = await fetchCsvToStudios(AIRTABLE_CSV_URL);
            
            // ログの追加：取得したデータを確認
            console.log('--- Airtableから読み込まれたデータ（最初の3件）---');
            console.log(studios.slice(0, 3)); 
            console.log('--------------------------------------------------');

        } else {
            // CSV URLが設定されていない場合はローカルJSONにフォールバック
            console.log('AIRTABLE_CSV_URLが未設定のため、data.jsonからデータを読み込みます。');
            studios = await fetchLocalJson();
        }
        
        // 初期化完了後に検索をバインド
        runSearch(studios);
        
    }catch(err){
        console.error('データの読み込みに失敗しました。', err);
        result.innerHTML = '<p style="color:red;">データの読み込みに失敗しました。Consoleのエラーを確認してください。</p>';
    }
}

// ページが完全にロードされたら非同期の初期化関数を実行
initializeApp();