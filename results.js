// ==========================================
// 📌 results.js - 検索ロジックと結果表示
// ==========================================

// 🔧 定数設定
const AREA_PER_PERSON = 5; // 1人あたり必要な面積（㎡）

// ==========================================
// 📦 ユーティリティ関数（共通）
// ==========================================

/**
 * 時刻を分に変換
 * @param {string} hhmm - "HH:MM" 形式の時刻
 * @returns {number} - 分単位の数値
 * 例: "18:30" → 1110 (18*60 + 30)
 */
function toMinutes(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/**
 * HTMLエスケープ処理（XSS対策）
 */
function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 属性値のエスケープ処理
 */
function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
}

/**
 * 価格をフォーマット
 * @param {number} price - 価格
 * @returns {string} - "¥5,000" 形式
 */
function formatPrice(price) {
    return price !== null 
        ? `¥${Math.round(price).toLocaleString()}` 
        : '料金未設定';
}

/**
 * 日付から曜日を取得
 * @param {string} dateStr - "YYYY-MM-DD" 形式
 * @returns {string} - "平日" | "土曜" | "日曜"
 */
function getDayOfWeek(dateStr) {
    const date = new Date(dateStr + 'T12:00:00+09:00');
    const day = date.getDay(); // 0:日曜, 6:土曜
    
    if (isNaN(date)) return '平日';
    if (day === 0) return '日曜';
    if (day === 6) return '土曜';
    return '平日';
}

// ==========================================
// 📊 データ処理
// ==========================================

/**
 * 料金データのクリーンアップ
 * 
 * 🔧 改善: rate_nameが空でも有効なデータとして扱う
 */
function cleanRateData(r) {
    let price = (r.min_price || '').toString().replace(/[^\d.]/g, '');
    price = price ? Number(price) : null;
    
    const startTimeMatch = (r.start_time || '').match(/(\d{2}:\d{2})$/);
    const endTimeMatch = (r.end_time || '').match(/(\d{2}:\d{2})$/);

    return {
        rate_name: (r.rate_name || '').trim(),
        days_of_week: (r.days_of_week || '毎日').trim(), 
        start_time: startTimeMatch ? startTimeMatch[1] : (r.start_time || '').trim(),
        end_time: endTimeMatch ? endTimeMatch[1] : (r.end_time || '').trim(),
        min_price: price 
    };
}

/**
 * JSONデータをスタジオ構造に変換
 */
function processFetchedData(rows) {
    const studiosMap = {};
    
    rows.forEach(r => {
        const sid = (r.studio_id || r.studio_name || '').toString().trim();
        if (!sid) return;

        // スタジオが初登場なら初期化
        if (!studiosMap[sid]) {
            studiosMap[sid] = { 
                id: sid, 
                studio_name: (r.studio_name || '').trim(), 
                official_url: (r.official_url || '').trim(), 
                rooms: {} 
            };
        }
        const studio = studiosMap[sid];

        const rid = (r.room_id || r.room_name || '').toString().trim();
        if (!rid) return;
        
        // 部屋が初登場なら初期化
        if (!studio.rooms[rid]) {
            studio.rooms[rid] = { 
                id: rid, 
                room_name: (r.room_name || '').trim(), 
                area_sqm: r.area_sqm ? Number(r.area_sqm) : null, 
                recommended_max: r.recommended_max ? Number(r.recommended_max) : null,
                notes: (r.notes || '').trim(), 
                rates: [] 
            };
        }
        
        // 料金情報を追加
        const rate = cleanRateData(r);
        // 🔧 改善: rate_nameが空でも、時間と価格があれば有効
        if (rate.start_time && rate.min_price !== null) {
            studio.rooms[rid].rates.push(rate);
        }
    });

    // Mapをリスト形式に変換
    return Object.values(studiosMap).map(s => ({
        id: s.id, 
        studio_name: s.studio_name, 
        official_url: s.official_url, 
        rooms: Object.values(s.rooms)
    }));
}

/**
 * JSONファイルを読み込み
 */
async function fetchLocalJson() { 
    const res = await fetch('data.json');
    if (!res.ok) {
        throw new Error('data.json fetch failed: ' + res.status);
    }
    const data = await res.json();
    return processFetchedData(data);
}

// ==========================================
// 💰 料金計算ロジック（コア機能）
// ==========================================

/**
 * 🎯 深夜パック判定関数
 * 
 * 判定基準:
 * 1. rate_nameに「深夜」「ナイトパック」が含まれる
 * 2. または、23:00〜6:00の時間帯で7時間以上のパック料金
 * 
 * @param {Object} rate - 料金情報
 * @returns {boolean} - 深夜パックならtrue
 */
function isNightPackRate(rate) {
    const rateName = (rate.rate_name || '').toLowerCase();
    
    // 方法1: rate_nameで判定（文字コード問題対応）
    if (rateName.includes('深夜') || 
        rateName.includes('しんや') ||
        rateName.includes('ナイトパック') || 
        rateName.includes('ないとぱっく') ||
        rateName.includes('night')) {
        return true;
    }
    
    // 方法2: 時間帯で判定（23:00開始 or 終了が6:00以前）
    const startMin = toMinutes(rate.start_time);
    const endMin = toMinutes(rate.end_time);
    
    if (startMin >= 23 * 60 || endMin <= 6 * 60) {
        // さらに7時間パックかチェック（深夜パックの特徴）
        let duration = endMin - startMin;
        if (duration < 0) duration += 24 * 60; // 日をまたぐ場合
        
        if (duration >= 6.5 * 60) { // 6.5時間以上なら深夜パック扱い
            return true;
        }
    }
    
    return false;
}
 * 
 * ロジック解説:
 * 1. 利用時間を1時間ごとに分割（端数は切り上げ）
 * 2. 各1時間について、該当する料金帯を検索
 * 3. 曜日と時間帯が一致する料金を合計
 * 
 * @param {Array} rates - 部屋の料金体系リスト
 * @param {number} startMin - 利用開始時刻（分）
 * @param {number} endMin - 利用終了時刻（分）
 * @param {string} targetDayOfWeek - 利用する曜日
 * @returns {number | null} - 総額（見つからない場合はnull）
 */
function calculateTotalCost(rates, startMin, endMin, targetDayOfWeek) {
    let totalCost = 0;
    
    // 例: 18:00〜20:30 → 3時間分の料金を計算
    const totalHours = Math.ceil((endMin - startMin) / 60);

    // 1時間ごとにループ
    for (let hour = 0; hour < totalHours; hour++) {
        const currentStartMin = startMin + hour * 60;
        
        if (currentStartMin >= endMin) continue;

        let hourlyCost = null;

        // この1時間に該当する料金帯を検索
        for (const rate of rates) {
            const rateStartMin = toMinutes(rate.start_time);
            const rateEndMin = toMinutes(rate.end_time);
            
            // ✅ 条件1: 曜日が一致するか
            const dayMatches = rate.days_of_week === '毎日' 
                || rate.days_of_week.includes(targetDayOfWeek);
            
            // ✅ 条件2: 時間帯が一致するか
            // 例: 17:00の利用が「12:00〜18:00」の料金帯に含まれるか
            const timeMatches = (rateStartMin <= currentStartMin && currentStartMin < rateEndMin);

            if (dayMatches && timeMatches) {
                hourlyCost = rate.min_price;
                break; // 最初にマッチした料金を採用
            }
        }

        if (hourlyCost === null) {
            // 料金設定がない時間帯が含まれる → 利用不可
            return null; 
        }

        totalCost += hourlyCost;
    }

    return totalCost;
}

// ==========================================
// 🎨 検索結果の表示
// ==========================================

/**
 * 検索結果をカード形式で表示
 * 
 * 🎯 改善点: 総額を基本表示、1人あたり金額は補足として表示
 */
function renderCards(items, requestedPeople, requestedArea, searchMode, totalDuration, targetDayOfWeek) {
    const resultElement = document.getElementById('result');
    const summaryElement = document.getElementById('searchSummary');
    
    // 結果が0件の場合
    if (items.length === 0) {
        resultElement.innerHTML = '<div class="no-results">該当するスタジオは見つかりませんでした。<br>検索ページに戻り、条件を変更してください。</div>';
        summaryElement.innerHTML = `0件のスタジオが見つかりました (${requestedPeople}名 / 必要面積: ${requestedArea}㎡)`;
        return;
    }
    
    // サマリー表示
    const modeName = searchMode === 'night' 
        ? '🌜 深夜パック' 
        : `🌞 時間貸し (${totalDuration}時間利用)`;
    
    summaryElement.innerHTML = `
        ✨ <strong>${items.length}件</strong>のスタジオが見つかりました (${targetDayOfWeek} ${modeName}) 
        <span class="summary-details">| 希望人数: ${requestedPeople}名 / 必要面積: ${requestedArea}㎡</span>
    `;

    // カード一覧を生成
    resultElement.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'card-grid';

    items.forEach(item => {
        if (!item.room || item.totalCost === null) return;
        
        const div = document.createElement('div');
        div.className = 'card';

        // 💰 総額と1人あたり金額を計算
        const totalCost = item.totalCost;
        const perPersonCost = requestedPeople > 0 
            ? totalCost / requestedPeople 
            : null;
        
        // 料金表示HTML（総額を強調）
        const costHtml = `
            <div class="cost-display">
                <div class="total-cost">
                    <div class="label">部屋全体の総額</div>
                    <div class="price">${formatPrice(totalCost)}</div>
                </div>
                <div class="per-person-cost">
                    1人あたり: ${formatPrice(perPersonCost)}
                </div>
            </div>
        `;
        
        // 部屋の面積チェック
        const roomArea = item.room.area_sqm;
        const areaFitStatus = roomArea && roomArea >= requestedArea 
            ? `適合 (${roomArea}㎡)` 
            : `**注意** (${roomArea ?? '未記載'}㎡)`;
        const areaFitClass = roomArea && roomArea >= requestedArea ? '' : 'warning';
        
        const notes = item.room.notes || '特記事項なし';
        
        div.innerHTML = `
            <div>
                <h3>${escapeHtml(item.studio_name)}</h3>
                <div class="room-name">${escapeHtml(item.room_name)}</div>
                
                ${costHtml}

                <div class="meta-item">
                    <span>面積</span>
                    <strong class="${areaFitClass}">${areaFitStatus}</strong> 
                </div>
                <div class="meta-item">
                    <span>その他/備考</span>
                    <strong>${escapeHtml(notes)}</strong>
                </div>
            </div>
            <a href="${escapeAttr(item.studio_url || '#')}" target="_blank">
                <button>公式サイトで料金をチェック →</button>
            </a>
        `;
        grid.appendChild(div);
    });
    
    resultElement.appendChild(grid);
}

// ==========================================
// 🔍 検索ロジック本体
// ==========================================

/**
 * スタジオを検索
 * 
 * ロジックの流れ:
 * 1. 検索条件を取得
 * 2. 各スタジオの各部屋をチェック
 * 3. 条件に合う部屋の料金を計算
 * 4. 結果をソートして表示
 */
function runSearch(studios, params) {
    const dateStr = params.date;
    const startMin = toMinutes(params.startTime);
    const endMin = toMinutes(params.endTime);
    const maxPrice = params.price;
    const requestedPeople = params.people; 
    const searchMode = params.mode;

    const targetDayOfWeek = getDayOfWeek(dateStr);
    const requiredArea = requestedPeople * AREA_PER_PERSON;
    const totalDurationHours = Math.ceil((endMin - startMin) / 60);

    // 🚫 無効な検索条件
    if (requestedPeople <= 0 || (searchMode === 'day' && startMin >= endMin)) {
        renderCards([], 0, 0, searchMode, 0, targetDayOfWeek);
        return;
    }
    
    const results = [];

    // 全スタジオをチェック
    studios.forEach(studio => {
        (studio.rooms || []).forEach(room => {
            // ❌ 面積が足りない部屋はスキップ
            if (room.area_sqm == null || room.area_sqm < requiredArea) return; 

            // 🌞 通常検索: 時間帯をまたいだ料金計算
            if (searchMode === 'day') {
                const totalCost = calculateTotalCost(room.rates, startMin, endMin, targetDayOfWeek);
                
                // ❌ 料金が予算オーバーならスキップ
                if (totalCost === null || totalCost > maxPrice) return;

                results.push({
                    studio_name: studio.studio_name,
                    studio_url: studio.official_url,
                    room_name: room.room_name,
                    room: room,
                    totalCost: totalCost
                });
            } 
            
            // 🌙 深夜パック検索
            else if (searchMode === 'night') {
                // 🔧 修正: 同じ部屋に複数の深夜パックがある場合は最安値のみを採用
                let cheapestNightPack = null;
                
                (room.rates || []).forEach(rate => {
                    // 🎯 改善された深夜パック判定
                    if (!isNightPackRate(rate)) return;
                    
                    const dayMatches = rate.days_of_week === '毎日' || 
                                     rate.days_of_week.includes(targetDayOfWeek);
                    
                    if (dayMatches) {
                        const totalCost = rate.min_price;
                        
                        // 予算オーバーならスキップ
                        if (totalCost > maxPrice) return;
                        
                        // 最安値を更新
                        if (cheapestNightPack === null || totalCost < cheapestNightPack) {
                            cheapestNightPack = totalCost;
                        }
                    }
                });
                
                // 最安値の深夜パックが見つかった場合のみ結果に追加
                if (cheapestNightPack !== null) {
                    results.push({
                        studio_name: studio.studio_name,
                        studio_url: studio.official_url,
                        room_name: room.room_name,
                        room: room,
                        totalCost: cheapestNightPack
                    });
                }
            }
        });
    });

    // 📊 総額が安い順にソート
    results.sort((a, b) => {
        return (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity);
    });

    renderCards(results, requestedPeople, requiredArea, searchMode, totalDurationHours, targetDayOfWeek);
}

// ==========================================
// 🚀 初期化処理
// ==========================================

/**
 * URLパラメータから検索条件を取得
 */
function getSearchParams() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        date: urlParams.get('date') || '',
        startTime: urlParams.get('startTime') || '00:00',
        endTime: urlParams.get('endTime') || '00:00',
        price: Number(urlParams.get('price')) || Infinity,
        people: Number(urlParams.get('people')) || 0,
        mode: urlParams.get('mode') || 'day'
    };
}

/**
 * アプリケーション初期化
 */
async function initializeApp() {
    try {
        const params = getSearchParams();
        
        // バリデーション
        if (params.people <= 0 || (params.mode === 'day' && (!params.date || params.startTime === params.endTime))) {
            document.getElementById('result').innerHTML = '<div class="no-results">無効な検索条件です。検索ページに戻り、人数または時間帯を指定してください。</div>';
            document.getElementById('searchSummary').textContent = '';
            return;
        }
        
        // データ読み込み
        const studios = await fetchLocalJson();
        
        // 検索実行
        runSearch(studios, params);
        
    } catch (err) {
        console.error('データの読み込みまたは検索処理に失敗しました。', err);
        document.getElementById('result').innerHTML = '<div class="no-results" style="color:#ef4444;">データの読み込みに失敗しました。<br>コンソール (F12) のエラーを確認してください。</div>';
    }
}

// ページ読み込み時に実行
document.addEventListener('DOMContentLoaded', initializeApp);