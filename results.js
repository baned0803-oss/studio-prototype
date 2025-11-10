// results.js (検索ロジックと結果表示)

const AREA_PER_PERSON = 5; 

// --- ユーティリティ関数（共通） ---
function toMinutes(hhmm){
    if(!hhmm) return null;
    const [h,m] = hhmm.split(':').map(Number);
    return h*60 + m;
}

// ⭐ 追加された関数: 分をHH:MM形式に戻す ⭐
function toHHMM(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function escapeHtml(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeAttr(s){ return String(s || '').replace(/"/g,'&quot;'); }
function formatPrice(price) { return price !== null ? `¥${Math.round(price).toLocaleString()}` : '料金未設定'; }

/**
 * 日付文字列から曜日を取得
 * @param {string} dateStr YYYY-MM-DD形式
 * @returns {string} '平日', '土曜', '日曜'
 */
function getDayOfWeek(dateStr) {
    // YYYY-MM-DDをそのままDateコンストラクタに渡すとタイムゾーン問題でズレる場合があるため、時刻を付けて日本時間に設定
    const date = new Date(dateStr + 'T12:00:00+09:00'); 
    const day = date.getDay(); // 0:日曜, 1:月曜, ..., 6:土曜
    
    if (isNaN(date)) return '平日'; // 無効な日付の場合はデフォルトで平日
    if (day === 0) return '日曜';
    if (day === 6) return '土曜';
    
    // 祝日判定ロジックは複雑なため、ここでは一旦 土日のみで判定
    return '平日';
}

// データクリーンアップロジック (曜日情報取得を追加)
function cleanRateData(r) {
    let price = (r.min_price || '').toString().replace(/[^\d.]/g, '');
    price = price ? Number(price) : null;
    
    const startTimeMatch = (r.start_time || '').match(/(\d{2}:\d{2})$/);
    const endTimeMatch = (r.end_time || '').match(/(\d{2}:\d{2})$/);

    return {
        rate_name: (r.rate_name||'').trim(),
        // ⭐ 曜日情報を取得するように修正 ⭐
        days_of_week: (r.days_of_week || '毎日').trim(), 
        start_time: startTimeMatch ? startTimeMatch[1] : (r.start_time||'').trim(),
        end_time: endTimeMatch ? endTimeMatch[1] : (r.end_time||'').trim(),
        min_price: price 
    };
}

function processFetchedData(rows) {
    const studiosMap = {};
    rows.forEach(r=>{
         const sid = (r.studio_id || r.studio_name || '').toString().trim();
         if(!sid) return;

         if(!studiosMap[sid]) {
             studiosMap[sid] = { 
                 id: sid, 
                 studio_name: (r.studio_name||'').trim(), 
                 official_url: (r.official_url||'').trim(), 
                 rooms: {} 
             };
         }
         const s = studiosMap[sid];

         const rid = (r.room_id || r.room_name || '').toString().trim();
         if(!rid) return;
         
         if(!s.rooms[rid]) {
             s.rooms[rid] = { 
                 id: rid, 
                 room_name: (r.room_name||'').trim(), 
                 area_sqm: r.area_sqm ? Number(r.area_sqm) : null, 
                 recommended_max: r.recommended_max ? Number(r.recommended_max) : null,
                 notes: (r.notes || '').trim(), 
                 rates: [] 
             };
         }
         
         const rate = cleanRateData(r);

         if(rate.rate_name && rate.start_time && rate.min_price !== null) {
              s.rooms[rid].rates.push(rate);
         }
    });

    return Object.values(studiosMap).map(s=>({ id: s.id, studio_name: s.studio_name, official_url: s.official_url, rooms: Object.values(s.rooms) }));
}

async function fetchLocalJson(){ 
    const res = await fetch('data.json');
    if(!res.ok) throw new Error('data.json fetch failed: '+res.status + ' - JSONファイルが見つからないか、パスが間違っています。');
    const data = await res.json();
    return processFetchedData(data);
}

// --- ⭐ 追加されたコスト計算関数 ⭐ ---

/**
 * 指定された利用時間帯の総額を計算する
 * @param {Array} rates 部屋の料金体系リスト
 * @param {number} startMin 利用開始時刻（分）
 * @param {number} endMin 利用終了時刻（分）
 * @param {string} targetDayOfWeek 利用する曜日 ('平日', '土曜', '日曜')
 * @returns {number | null} 総額（見つからない場合はnull）
 */
function calculateTotalCost(rates, startMin, endMin, targetDayOfWeek) {
    let totalCost = 0;
    
    // 料金計算は1時間単位で行う (端数は切り上げ)
    const totalDurationHours = Math.ceil((endMin - startMin) / 60);

    for (let i = 0; i < totalDurationHours; i++) {
        const currentHourStartMin = startMin + i * 60;
        
        if (currentHourStartMin >= endMin) continue;

        let hourlyCost = null;

        // 該当する料金帯を検索
        for (const rate of rates) {
            const rateStartMin = toMinutes(rate.start_time);
            const rateEndMin = toMinutes(rate.end_time);
            
            // 1. 曜日が一致するかチェック
            const dayMatches = rate.days_of_week === '毎日' || rate.days_of_week.includes(targetDayOfWeek);
            
            // 2. 時間帯が一致するかチェック (利用開始時が料金帯に含まれるか)
            // 例: 17:00〜18:00の利用なら、17:00が料金帯に含まれるか
            const timeMatches = (rateStartMin <= currentHourStartMin && currentHourStartMin < rateEndMin);

            if (dayMatches && timeMatches) {
                hourlyCost = rate.min_price;
                break; // 最初のマッチした料金帯を採用
            }
        }

        if (hourlyCost === null) {
            // 利用時間帯の一部に料金設定がない場合は、この部屋は利用不可とみなす
            return null; 
        }

        totalCost += hourlyCost;
    }

    return totalCost;
}

// --- レンダリング関数 (総額表示に対応して修正) ---
function renderCards(items, requestedPeople, requestedArea, searchMode, totalDuration, targetDayOfWeek){
    const resultElement = document.getElementById('result');
    const summaryElement = document.getElementById('searchSummary');
    
    if(items.length === 0){
        resultElement.innerHTML = '<div class="no-results">該当するスタジオは見つかりませんでした。<br>検索ページに戻り、条件を変更してください。</div>';
        summaryElement.innerHTML = `0件のスタジオが見つかりました (${requestedPeople}名 / 必要面積: ${requestedArea}㎡)`;
        return;
    }
    
    const modeName = searchMode === 'night' ? '🌜 深夜パック' : `🌞 時間貸し (${totalDuration}時間利用)`;
    
    // サマリー表示を更新
    summaryElement.innerHTML = `
        ✨ <strong>${items.length}件</strong>のスタジオが見つかりました (${targetDayOfWeek} ${modeName}) 
        <span class="summary-details">| 希望人数: ${requestedPeople}名 / 必要面積: ${requestedArea}㎡</span>
    `;

    resultElement.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'card-grid';

    items.forEach(it=>{
        if (!it.room || it.totalCost === null) return;
        
        const div = document.createElement('div');
        div.className = 'card';

        // 総額と1人あたり総額を算出
        const totalCost = it.totalCost;
        const totalCostPerPerson = requestedPeople > 0 ? totalCost / requestedPeople : null;
        
        // 料金表示
        let costHtml;
        if (searchMode === 'night') {
             costHtml = `<div class="cost-per-person">
                            <div class="label">パック総額 (${escapeHtml(it.rate_name)})</div>
                            <div class="price">${formatPrice(totalCost)}</div>
                         </div>`;
        } else {
             costHtml = `<div class="cost-per-person">
                      <div class="label">総額 (1人あたり)</div>
                      <div class="price">${formatPrice(totalCostPerPerson)}</div>
                   </div>`;
        }
        
        // 部屋の面積と適合性をチェック
        const roomArea = it.room.area_sqm;
        const areaFitStatus = roomArea && roomArea >= requestedArea ? `適合 (${roomArea}㎡)` : `**注意** (${roomArea ?? '未記載'}㎡)`;
        const areaFitClass = roomArea && roomArea >= requestedArea ? '' : 'warning';
        
        // 備考情報
        const notes = it.room.notes || '特記事項なし';
        
        div.innerHTML = `
            <div>
                <h3>${escapeHtml(it.studio_name)}</h3>
                <div class="room-name">${escapeHtml(it.room_name)}</div>
                
                ${costHtml}

                <div class="meta-item">
                    <span>総額 (部屋全体)</span>
                    <strong>${formatPrice(totalCost)}</strong>
                </div>
                <div class="meta-item">
                    <span>必要面積 (目安)</span>
                    <strong class="${areaFitClass}">${areaFitStatus}</strong> 
                </div>
                <div class="meta-item">
                    <span>推奨最大人数</span>
                    <strong>${(it.room.recommended_max ?? '-')}人</strong>
                </div>
                <div class="meta-item">
                    <span>その他/備考</span>
                    <strong>${escapeHtml(notes)}</strong>
                </div>
            </div>
            <a href="${escapeAttr(it.studio_url || '#')}" target="_blank">
                <button>公式サイトで料金をチェック →</button>
            </a>
        `;
        grid.appendChild(div);
    });
    
    resultElement.appendChild(grid);
}

// --- 検索ロジック本体 (総額計算に対応して修正) ---
function runSearch(studios, params){
    const dateStr = params.date;
    const startMin = toMinutes(params.startTime);
    const endMin = toMinutes(params.endTime);
    const maxPrice = params.price;
    const requestedPeople = params.people; 
    const searchMode = params.mode;

    const targetDayOfWeek = getDayOfWeek(dateStr);
    const requiredArea = requestedPeople * AREA_PER_PERSON;
    
    // 利用時間の合計（端数切り上げ後の時間数）
    const totalDurationHours = Math.ceil((endMin - startMin) / 60);

    if(requestedPeople <= 0 || (searchMode === 'day' && startMin >= endMin)) {
        renderCards([], 0, 0, searchMode, 0, targetDayOfWeek);
        return;
    }
    
    const results = [];

    studios.forEach(studio=>{
        (studio.rooms || []).forEach(room=>{
            // 必須条件: 部屋の面積が必要面積以上であること
            if(room.area_sqm == null || room.area_sqm < requiredArea) return; 

            // Dayモードの場合: 料金帯を跨いだ総額計算
            if (searchMode === 'day') {
                const totalCost = calculateTotalCost(room.rates, startMin, endMin, targetDayOfWeek);
                
                if (totalCost === null || totalCost > maxPrice) return; // 利用不可 or 最大価格オーバー

                // 検索結果として追加
                results.push({
                    studio_name: studio.studio_name,
                    studio_url: studio.official_url,
                    room_name: room.room_name,
                    room: room,
                    totalCost: totalCost, // 総額を直接保持
                    totalCostPerPerson: totalCost / requestedPeople,
                    rate_name: '時間貸し総額'
                });
            } 
            
            // Nightモードの場合: 深夜パック料金を検索
            else if (searchMode === 'night') {
                (room.rates || []).forEach(rate => {
                    const rateName = (rate.rate_name || '').toLowerCase();
                    const isNightPack = rateName.includes('深夜') || rateName.includes('ナイトパック');
                    
                    // Nightモードで、かつ曜日が一致するか
                    const dayMatches = rate.days_of_week === '毎日' || rate.days_of_week.includes(targetDayOfWeek);

                    if(isNightPack && dayMatches) {
                        const totalCost = rate.min_price;
                        if (totalCost > maxPrice) return;

                         results.push({
                            studio_name: studio.studio_name,
                            studio_url: studio.official_url,
                            room_name: room.room_name,
                            room: room,
                            totalCost: totalCost,
                            rate_name: rate.rate_name,
                        });
                    }
                });
            }
        });
    });

    // ソート: 常に全体総額が安い順
    results.sort((a,b)=>{
        return (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity);
    });

    renderCards(results, requestedPeople, requiredArea, searchMode, totalDurationHours, targetDayOfWeek);
}

// --- 初期化処理 ---

// ⭐ getSearchParams 関数を修正 ⭐
function getSearchParams() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        date: urlParams.get('date') || '', // ⭐ date を取得 ⭐
        startTime: urlParams.get('startTime') || '00:00', // ⭐ startTime を取得 ⭐
        endTime: urlParams.get('endTime') || '00:00', // ⭐ endTime を取得 ⭐
        price: Number(urlParams.get('price')) || Infinity,
        people: Number(urlParams.get('people')) || 0,
        mode: urlParams.get('mode') || 'day'
    };
}

async function initializeApp(){
    try{
        const params = getSearchParams();
        
        if (params.people <= 0 || (params.mode === 'day' && (!params.date || params.startTime === params.endTime))) {
             document.getElementById('result').innerHTML = '<div class="no-results">無効な検索条件です。検索ページに戻り、人数または時間帯を指定してください。</div>';
             document.getElementById('searchSummary').textContent = '';
             return;
        }
        
        // データ読み込み
        const studios = await fetchLocalJson();
        
        // 検索実行
        runSearch(studios, params);
        
    }catch(err){
        console.error('データの読み込みまたは検索処理に失敗しました。', err);
        document.getElementById('result').innerHTML = '<div class="no-results" style="color:#ef4444;">データの読み込みに失敗しました。<br>コンソール (F12) のエラーを確認してください。</div>';
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);