// ==========================================
// 📌 results.js - 検索ロジックと結果表示 (全機能統合・安定版)
// ==========================================

// 🔧 定数設定
const AREA_PER_PERSON = 5; // 1人あたり必要な面積（㎡）

// ==========================================
// 📦 ユーティリティ関数（共通）
// ==========================================

/**
 * 時刻を分に変換
 * @param {string} hhmm - "HH:MM" 形式の時刻
 * @returns {number | null} - 分単位の数値。無効な場合は null を返す。
 */
function toMinutes(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
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
 * @returns {string} - "¥1,234" 形式
 */
function formatPrice(price) {
    return price !== null 
        ? `¥${Math.round(price).toLocaleString()}` 
        : '料金未設定';
}

/**
 * 日付から曜日を取得（日本語）
 * @param {string} dateStr - "YYYY-MM-DD" 形式
 * @returns {string} - "平日" | "土曜" | "日曜"
 */
function getDayOfWeek(dateStr) {
    // T12:00:00+09:00を付加し、タイムゾーンの影響を排除
    const date = new Date(dateStr + 'T12:00:00+09:00');
    if (isNaN(date.getTime())) return '平日'; // 日付が無効なら平日扱い

    const day = date.getDay(); // 0:日曜, 6:土曜
    if (day === 0) return '日曜';
    if (day === 6) return '土曜';
    return '平日';
}

/**
 * 深夜パック料金かどうかを判定
 */
function isNightPackRate(rate) {
    const rateName = (rate.rate_name || '').toLowerCase();
    
    // 方法1: rate_nameで判定
    if (rateName.includes('深夜') || rateName.includes('ナイトパック') || rateName.includes('night')) {
        return true;
    }
    
    // 方法2: 時間帯で判定（23:00〜翌朝など、日をまたぐ長時間パック）
    const startMin = toMinutes(rate.start_time);
    const endMin = toMinutes(rate.end_time);
    
    if (endMin !== null && startMin !== null && endMin < startMin) {
        let duration = endMin - startMin;
        duration += 24 * 60; // 日をまたぐので24時間を加算
        
        if (duration >= 6 * 60) { // 6時間以上なら深夜パック扱い
            return true;
        }
    }
    
    return false;
}

// ==========================================
// 📊 データ処理
// ==========================================

/**
 * 料金データのクリーンアップ
 */
function cleanRateData(r) {
    let price = (r.min_price || '').toString().replace(/[^\d.]/g, '');
    price = price ? Number(price) : null;
    
    const startTimeMatch = (r.start_time || '').match(/(\d{1,2}:\d{2})$/);
    const endTimeMatch = (r.end_time || '').match(/(\d{1,2}:\d{2})$/);

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
        // studio_idがない場合はstudio_nameを代替キーとして使用
        const sid = (r.studio_id && r.studio_id !== '-' ? r.studio_id : r.studio_name).toString().trim();
        if (!sid) return;

        if (!studiosMap[sid]) {
            studiosMap[sid] = { 
                id: sid, 
                studio_name: (r.studio_name || '').trim(), 
                official_url: (r.official_url || '').trim(), 
                rooms: {} 
            };
        }
        const studio = studiosMap[sid];

        // room_idがない場合はroom_nameを代替キーとして使用
        const rid = (r.room_id && r.room_id !== '-' ? r.room_id : r.room_name).toString().trim();
        if (!rid) return;
        
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
        
        const rate = cleanRateData(r);
        if (rate.start_time && rate.min_price !== null) {
            studio.rooms[rid].rates.push(rate);
        }
    });

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
// 💰 料金計算ロジック (総額と適用料金区分を算出)
// ==========================================

/** * 1. 利用時間を1時間ごとに分割（端数は切り上げ）
 * 2. 各1時間について、該当する料金帯を検索
 * 3. 曜日と時間帯が一致する料金を合計
 * @returns {Object} - { totalCost: number | null, appliedRates: Array }
 */
function calculateTotalCost(rates, startMin, endMin, targetDayOfWeek) {
    let totalCost = 0;
    const appliedRates = []; // 適用された料金区分オブジェクト
    const appliedRateKeys = new Set(); // 重複を防ぐためのキーセット
    
    // 例: 18:00〜20:30 → 3時間分の料金を計算 (端数は切り上げ)
    const totalDurationMin = endMin - startMin;
    const totalHours = Math.ceil(totalDurationMin / 60);

    // 1時間ごとにループ
    for (let hour = 0; hour < totalHours; hour++) {
        const currentStartMin = startMin + hour * 60;
        
        // 最終時間チェック
        if (currentStartMin >= endMin) continue;

        let hourlyCost = null;
        let matchingRate = null;

        // この1時間に該当する料金帯を検索
        for (const rate of rates) {
            // 深夜パックは時間貸し計算から除外
            if (isNightPackRate(rate)) continue; 
            
            const rateStartMin = toMinutes(rate.start_time);
            const rateEndMin = toMinutes(rate.end_time);
            
            // ✅ 条件1: 曜日が一致するか
            let dayMatches = false;
            const studioDays = rate.days_of_week.split(',').map(d => d.trim());
            
            if (rate.days_of_week === '毎日') {
                dayMatches = true;
            } else if (studioDays.includes(targetDayOfWeek)) {
                dayMatches = true;
            } else if (studioDays.includes('平日') && targetDayOfWeek === '平日') {
                dayMatches = true;
            } else if (studioDays.includes('土日祝') && (targetDayOfWeek === '土曜' || targetDayOfWeek === '日曜')) {
                dayMatches = true;
            }
            
            // ✅ 条件2: 時間帯が一致するか
            const timeMatches = (rateStartMin !== null && rateEndMin !== null && rateStartMin <= currentStartMin && currentStartMin < rateEndMin);

            if (dayMatches && timeMatches) {
                hourlyCost = rate.min_price;
                matchingRate = rate; // マッチした料金オブジェクトを保存
                break; // 最初にマッチした料金を採用
            }
        }

        if (hourlyCost === null) {
            // 料金設定がない時間帯が含まれる → 利用不可
            return { totalCost: null, appliedRates: [] }; 
        }

        totalCost += hourlyCost;

        // 適用された料金をリストに追加（重複排除）
        const rateKey = `${matchingRate.days_of_week}-${matchingRate.start_time}-${matchingRate.end_time}-${matchingRate.min_price}`;
        if (!appliedRateKeys.has(rateKey)) {
            appliedRateKeys.add(rateKey);
            appliedRates.push({
                rate_name: matchingRate.rate_name,
                start_time: matchingRate.start_time,
                end_time: matchingRate.end_time,
                min_price: matchingRate.min_price
            });
        }
    }

    return { totalCost: totalCost, appliedRates: appliedRates };
}

// ==========================================
// 🎨 検索結果の表示
// ==========================================

/**
 * スタジオの結果カードを作成
 */
function createStudioCard(item, params) {
    
    // 💰 総額と1人あたり金額を計算
    const totalCost = item.totalCost;
    const requestedPeople = params.people;
    const perPersonCost = requestedPeople > 0 
        ? totalCost / requestedPeople 
        : null;
    
    // 🎯 修正: 深夜パックの場合は時間表示を省略
    const timeRangeText = (params.mode === 'day' && params.startTime && params.endTime) 
        ? ` (${escapeHtml(params.startTime)} - ${escapeHtml(params.endTime)})` 
        : ''; 
    
    // 部屋の面積チェック
    const roomArea = item.room.area_sqm;
    const requiredArea = params.people * AREA_PER_PERSON;
    
    const areaFitStatus = roomArea != null && roomArea >= requiredArea 
        ? `適合 (${roomArea}㎡)` 
        : `**注意** (${roomArea ?? '未記載'}㎡)`;
    const areaFitClass = roomArea != null && roomArea >= requiredArea ? '' : 'warning';
    
    const notes = item.room.notes || '特記事項なし';
    
    // 📌 修正: 料金データ一覧HTMLの生成
    const uniqueAppliedRates = item.appliedRates || [];

    const appliedRatesHtml = (uniqueAppliedRates || []).map(rate => {
        // 深夜パックの場合は「パック料金」と表示
        const isPack = isNightPackRate(rate); 
        const priceText = isPack ? formatPrice(rate.min_price) : `${formatPrice(rate.min_price)}/h`;
        const timeRange = `${escapeHtml(rate.start_time)} - ${escapeHtml(rate.end_time)}`;
        
        return `
            <div class="rate-data-row">
                <span>| ${timeRange} |</span>
                <strong>${priceText}</strong>
                ${isPack ? '<span class="rate-type-tag">(パック料金)</span>' : ''}
            </div>
        `;
    }).join('');

    // 料金表示HTML（総額と適用された料金データ一覧）
    const costHtml = `
        <div class="cost-display">
            <div class="total-cost-line">
                💰利用料金: <strong>${formatPrice(totalCost)}${timeRangeText}</strong>
            </div>
        </div>
        ${perPersonCost !== null ? `<div class="per-person-cost-line">1人あたり: ${formatPrice(perPersonCost)}</div>` : ''}

        ${uniqueAppliedRates && uniqueAppliedRates.length > 0 ? `
            <div class="rate-data-container">
                <strong>〇スタジオ料金データ</strong>
                ${appliedRatesHtml}
            </div>
        ` : ''}
    `;
    
    // カードのHTML構造を生成
    return `
        <div class="result-card">
            <h2 class="card-title">${escapeHtml(item.studio_name)} (${escapeHtml(item.room_name)})</h2>
            <div class="card-body">
                <div class="meta-item">
                    <span>📐広さ</span>
                    <strong class="${areaFitClass}">${escapeHtml(areaFitStatus)}</strong> 
                    <span class="note">(推奨最大人数: ${item.room.recommended_max ?? '未記載'}人)</span>
                </div>

                ${costHtml}

                <div class="meta-item notes-display">
                    <span>その他/備考</span>
                    <strong>${escapeHtml(notes)}</strong>
                </div>
            </div>
            <a href="${escapeAttr(item.studio_url || '#')}" target="_blank" class="detail-link">
                <button>公式サイトで詳細を見る →</button>
            </a>
        </div>
    `;
}

/**
 * 検索結果の表示
 */
function renderResults(filteredStudios, params) {
    const resultElement = document.getElementById('result');
    const summaryElement = document.getElementById('searchSummary');
    
    const targetDayOfWeek = getDayOfWeek(params.date);
    const requiredArea = params.people * AREA_PER_PERSON;
    const totalDurationHours = Math.ceil((toMinutes(params.endTime) - toMinutes(params.startTime)) / 60);

    // サマリーの表示
    const modeName = params.mode === 'night' 
        ? '🌜 深夜パック' 
        : `🌞 時間貸し (${totalDurationHours}時間利用)`;

    const budgetText = params.price === Infinity ? '無制限' : formatPrice(params.price);

    const summaryText = `
        ✨ <strong>${filteredStudios.length}件</strong>のスタジオが見つかりました (${targetDayOfWeek} ${modeName}) 
        <span class="summary-details">| 希望人数: ${params.people}名 / 必要面積: ${requiredArea}㎡ / 予算: ${budgetText}</span>
    `;
    summaryElement.innerHTML = summaryText;

    if (filteredStudios.length === 0) {
        resultElement.innerHTML = `
            <div class="no-results">
                <h3>ご希望の条件に合うスタジオは見つかりませんでした。</h3>
                <p>以下の条件を調整して、再度検索をお試しください。</p>
                <ul>
                    <li>利用時間帯や日付（曜日）</li>
                    <li>予算（最大料金）</li>
                    <li>人数（必要な広さが満たされているか）</li>
                </ul>
                <a href="index.html" class="back-link-bottom">← 検索条件を変更する</a>
            </div>
        `;
    } else {
        // カードをグリッド表示に変更
        const grid = document.createElement('div');
        grid.className = 'card-grid';
        
        filteredStudios.forEach(item => {
            const cardHtml = createStudioCard(item, params);
            grid.innerHTML += cardHtml;
        });

        resultElement.innerHTML = '';
        resultElement.appendChild(grid);
    }
}


// ==========================================
// 🔍 検索ロジック本体
// ==========================================

/**
 * スタジオを検索
 * @returns {Array<Object>} - 検索条件を満たしたユニークなスタジオと価格情報
 */
function runSearch(allStudios, params) {
    const dateStr = params.date;
    const startMin = toMinutes(params.startTime);
    const endMin = toMinutes(params.endTime);
    const maxPrice = params.price;
    const requestedPeople = params.people; 
    const searchMode = params.mode;

    const targetDayOfWeek = getDayOfWeek(dateStr);
    const requiredArea = requestedPeople * AREA_PER_PERSON;
    
    const results = [];

    allStudios.forEach(studio => {
        (studio.rooms || []).forEach(room => {
            // ❌ 面積が足りない部屋はスキップ
            if (room.area_sqm == null || room.area_sqm < requiredArea) return; 

            // 🌞 通常検索: 時間帯をまたいだ料金計算
            if (searchMode === 'day') {
                if (startMin === null || endMin === null || startMin >= endMin) return;

                const { totalCost, appliedRates } = calculateTotalCost(room.rates, startMin, endMin, targetDayOfWeek);
                
                // ❌ 料金が予算オーバー or nullならスキップ
                if (totalCost === null || totalCost > maxPrice) return;

                results.push({
                    studio_name: studio.studio_name,
                    studio_url: studio.official_url,
                    room_name: room.room_name,
                    room: room,
                    totalCost: totalCost,
                    appliedRates: appliedRates 
                });
            } 
            
            // 🌙 深夜パック検索
            else if (searchMode === 'night') {
                let cheapestNightPack = null;
                let cheapestNightRate = null;
                
                (room.rates || []).forEach(rate => {
                    if (!isNightPackRate(rate)) return; 
                    
                    const studioDays = rate.days_of_week.split(',').map(d => d.trim());
                    let dayMatches = false;
                    
                    if (rate.days_of_week === '毎日') {
                        dayMatches = true;
                    } else if (studioDays.includes(targetDayOfWeek)) {
                        dayMatches = true;
                    } else if (studioDays.includes('平日') && targetDayOfWeek === '平日') {
                        dayMatches = true;
                    } else if (studioDays.includes('土日祝') && (targetDayOfWeek === '土曜' || targetDayOfWeek === '日曜')) {
                        dayMatches = true;
                    }

                    if (dayMatches) {
                        const totalCost = rate.min_price;
                        if (totalCost === null || totalCost > maxPrice) return;
                        
                        if (cheapestNightPack === null || totalCost < cheapestNightPack) {
                            cheapestNightPack = totalCost;
                            cheapestNightRate = rate; 
                        }
                    }
                });
                
                if (cheapestNightPack !== null) {
                    results.push({
                        studio_name: studio.studio_name,
                        studio_url: studio.official_url,
                        room_name: room.room_name,
                        room: room,
                        totalCost: cheapestNightPack,
                        // 深夜パックの場合、appliedRatesは最安値のパック料金そのもの
                        appliedRates: [{
                            rate_name: cheapestNightRate.rate_name,
                            start_time: cheapestNightRate.start_time,
                            end_time: cheapestNightRate.end_time,
                            min_price: cheapestNightRate.min_price
                        }] 
                    });
                }
            }
        });
    });

    // 📊 総額が安い順にソート
    results.sort((a, b) => {
        return (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity);
    });

    // 結果表示
    renderResults(results, params);
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
        const isInvalidDayMode = params.mode === 'day' && (!params.date || params.startTime === params.endTime);
        if (params.people <= 0 || isInvalidDayMode) {
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
        document.getElementById('result').innerHTML = `
            <div class="no-results" style="color:#ef4444;">
                データの読み込みに失敗しました。<br>
                **data.jsonの形式**に問題がないか確認してください。<br>
                （特に、JSONの構文エラーやカンマ抜けがないか）
            </div>
        `;
    }
}

// ページ読み込み時に実行
document.addEventListener('DOMContentLoaded', initializeApp);