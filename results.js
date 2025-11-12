// ==========================================
// 📌 results.js - 検索ロジックと結果表示 (総額計算・料金区分表示対応版)
// ==========================================

// 🔧 定数設定
const AREA_PER_PERSON = 5; // 1人あたり必要な面積（㎡）

// ==========================================
// 📦 ユーティリティ関数（共通）
// ==========================================

/**
 * 時刻を分に変換
 * @param {string} hhmm - "HH:MM" 形式の時刻
 * @returns {number} - 分単位の数値。無効な場合は 0 を返す。
 */
function toMinutes(hhmm) {
    if (!hhmm) return 0;
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
 * @returns {string} - "¥1,234" 形式
 */
function formatPrice(price) {
    return `¥${(price || 0).toLocaleString()}`;
}

/**
 * JSONデータをローカルから取得
 */
async function fetchLocalJson() {
    const response = await fetch('data.json');
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

/**
 * 日付から曜日を取得（日本語）
 */
function getDayOfWeek(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return ''; 
    const days = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];
    return days[date.getDay()];
}

/**
 * 深夜パック料金かどうかを判定
 */
function isNightPackRate(rate) {
    return rate.rate_name && rate.rate_name.includes('深夜');
}

// ==========================================
// 💰 料金計算ロジック (総額と適用料金区分を算出)
// ==========================================

/** * 1. 利用時間を1時間ごとに分割（端数は切り上げ）
 * 2. 各1時間について、該当する料金帯を検索
 * 3. 曜日と時間帯が一致する料金を合計
 * * @param {Array} rates - 部屋の料金体系リスト
 * @param {number} startMin - 利用開始時刻（分）
 * @param {number} endMin - 利用終了時刻（分）
 * @param {string} targetDayOfWeek - 利用する曜日
 * @returns {Object} - { totalCost: number | null, appliedRates: Array }
 */
function calculateTotalCost(rates, startMin, endMin, targetDayOfWeek) {
    let totalCost = 0;
    const appliedRates = []; // 適用された料金区分オブジェクト
    const appliedRateKeys = new Set(); // 重複を防ぐためのキーセット
    
    // 例: 18:00〜20:30 → 3時間分の料金を計算 (端数は切り上げ)
    const totalHours = Math.ceil((endMin - startMin) / 60);

    // 1時間ごとにループ
    for (let hour = 0; hour < totalHours; hour++) {
        const currentStartMin = startMin + hour * 60;
        
        // 最終時間チェック (例: 10:00-10:30の場合、1時間目の料金計算後に終了)
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
            } else if (studioDays.includes('平日') && targetDayOfWeek !== '土曜' && targetDayOfWeek !== '日曜') {
                dayMatches = true;
            } else if (studioDays.includes('土日祝') && (targetDayOfWeek === '土曜' || targetDayOfWeek === '日曜')) {
                dayMatches = true;
            }
            
            // ✅ 条件2: 時間帯が一致するか
            const timeMatches = (rateStartMin <= currentStartMin && currentStartMin < rateEndMin);

            if (dayMatches && timeMatches) {
                hourlyCost = rate.min_price;
                matchingRate = rate; // マッチした料金オブジェクトを保存
                break; // 最初にマッチした料金を採用
            }
        }

        if (hourlyCost === null) {
            // 料金設定がない時間帯が含まれる → 利用不可
            console.warn(`料金設定が見つからない時間帯が含まれています: ${currentStartMin}分 (${targetDayOfWeek})`);
            return { totalCost: null, appliedRates: [] }; 
        }

        totalCost += hourlyCost;

        // 適用された料金をリストに追加（重複排除）
        const rateKey = `${matchingRate.days_of_week}-${matchingRate.start_time}-${matchingRate.end_time}-${matchingRate.min_price}`;
        if (!appliedRateKeys.has(rateKey)) {
            appliedRateKeys.add(rateKey);
            // 料金区分名、時間帯、価格を保存
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
// 💡 検索ロジック (修正版)
// ==========================================

/**
 * 検索条件を満たすスタジオを抽出し、利用可否と料金範囲を判定する
 * @param {Array<Object>} allStudios - data.json 全データ
 * @param {Object} params - 検索パラメータ
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
    const totalDurationHours = Math.ceil((endMin - startMin) / 60);

    // 【デバッグログ】検索ロジックの開始と主要変数の確認
    console.log('--- 実行ロジック確認 ---');
    console.log('計算された曜日:', targetDayOfWeek);
    console.log('必須面積:', requiredArea, '㎡');

    // 1. スタジオをroom_nameでグループ化
    const groupedStudios = allStudios.reduce((acc, current) => {
        // studio_idとroom_idをキーとして使用
        const studioId = current.studio_id && current.studio_id !== '-' ? current.studio_id : current.studio_name;
        const roomId = current.room_id && current.room_id !== '-' ? current.room_id : current.room_name;
        const key = `${studioId}-${roomId}`;

        if (!acc[key]) {
            acc[key] = {
                studio_name: current.studio_name,
                official_url: current.official_url,
                // ratesをroomオブジェクトに追加
                rooms: {
                    [current.room_name]: {
                        room_name: current.room_name,
                        area_sqm: current.area_sqm,
                        recommended_max: current.recommended_max,
                        notes: current.notes,
                        rates: [] 
                    }
                }
            };
        }
        
        // 部屋が存在しない場合は作成（通常ありえないが安全のため）
        if (!acc[key].rooms[current.room_name]) {
            acc[key].rooms[current.room_name] = {
                room_name: current.room_name,
                area_sqm: current.area_sqm,
                recommended_max: current.recommended_max,
                notes: current.notes,
                rates: []
            };
        }
        
        // 料金情報をrates配列に追加
        acc[key].rooms[current.room_name].rates.push(current);
        
        return acc;
    }, {});


    const uniqueStudios = Object.values(groupedStudios);
    const results = [];

    // 2. グループ化された各スタジオに対して検索条件を適用
    uniqueStudios.forEach(studio => {
        // 各部屋をチェック
        Object.values(studio.rooms).forEach(room => {
            // ❌ 面積が足りない部屋はスキップ
            const requiredArea = params.people * AREA_PER_PERSON;
            if (room.area_sqm == null || room.area_sqm < requiredArea) return; 

            // 🌞 通常検索: 時間帯をまたいだ料金計算
            if (searchMode === 'day') {
                const { totalCost, appliedRates } = calculateTotalCost(room.rates, startMin, endMin, targetDayOfWeek);
                
                // ❌ 料金が予算オーバー or nullならスキップ
                if (totalCost === null || totalCost > maxPrice) return;

                results.push({
                    studio_name: studio.studio_name,
                    studio_url: studio.official_url,
                    room_name: room.room_name,
                    room: room,
                    totalCost: totalCost,
                    appliedRates: appliedRates // 適用された料金を結果に追加
                });
            } 
            
            // 🌙 深夜パック検索 (ここは変更なし)
            else if (searchMode === 'night') {
                let cheapestNightPack = null;
                let nightRate = null;
                
                (room.rates || []).forEach(rate => {
                    if (!isNightPackRate(rate)) return; // 深夜パック料金のみチェック
                    
                    // 曜日チェック（深夜パックの場合、料金計算関数は使わない）
                    let dayMatches = false;
                    const studioDays = rate.days_of_week.split(',').map(d => d.trim());
                    
                    if (rate.days_of_week === '毎日') {
                        dayMatches = true;
                    } else if (studioDays.includes(targetDayOfWeek)) {
                        dayMatches = true;
                    } else if (studioDays.includes('平日') && targetDayOfWeek !== '土曜' && targetDayOfWeek !== '日曜') {
                        dayMatches = true;
                    } else if (studioDays.includes('土日祝') && (targetDayOfWeek === '土曜' || targetDayOfWeek === '日曜')) {
                        dayMatches = true;
                    }

                    if (dayMatches) {
                        const totalCost = rate.min_price;
                        if (totalCost > maxPrice) return;
                        
                        if (cheapestNightPack === null || totalCost < cheapestNightPack) {
                            cheapestNightPack = totalCost;
                            nightRate = rate; // 最安値のパック料金を保存
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
                        // 深夜パックの場合、appliedRatesはパック料金そのもの
                        appliedRates: [{
                            rate_name: nightRate.rate_name,
                            start_time: nightRate.start_time,
                            end_time: nightRate.end_time,
                            min_price: nightRate.min_price
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
// 🖥️ 結果表示ロジック (総額と料金区分リスト表示に対応)
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
    
    // 部屋の面積チェック
    const roomArea = item.room.area_sqm;
    const requiredArea = params.people * AREA_PER_PERSON;
    
    const areaFitStatus = roomArea != null && roomArea >= requiredArea 
        ? `適合 (${roomArea}㎡)` 
        : `**注意** (${roomArea ?? '未記載'}㎡)`;
    const areaFitClass = roomArea != null && roomArea >= requiredArea ? '' : 'warning';
    
    const notes = item.room.notes || '特記事項なし';
    
    // 📌 修正: 料金データ一覧HTMLの生成
    // 重複を排除した料金区分一覧
    const uniqueAppliedRates = Array.from(new Set(
        item.appliedRates.map(rate => `${rate.start_time}-${rate.end_time}-${rate.min_price}`)
    )).map(key => {
        const rate = item.appliedRates.find(r => `${r.start_time}-${r.end_time}-${r.min_price}` === key);
        return rate;
    });

    const appliedRatesHtml = (uniqueAppliedRates || []).map(rate => {
        // 深夜パックの場合は「パック料金」と表示
        const isPack = isNightPackRate(rate); 
        const priceText = isPack ? formatPrice(rate.min_price) : `${formatPrice(rate.min_price)}/h`;
        const timeRange = isPack 
            ? `${escapeHtml(rate.start_time)} - ${escapeHtml(rate.end_time)}`
            : `${escapeHtml(rate.start_time)} - ${escapeHtml(rate.end_time)}`;
        
        return `
            <div class="rate-data-row">
                <span>| ${timeRange} |</span>
                <strong>${priceText}</strong>
            </div>
        `;
    }).join('');

    // 料金表示HTML（総額と適用された料金データ一覧）
    const costHtml = `
        <div class="cost-display">
            <div class="total-cost-line">
                💰利用料金: <strong>${formatPrice(totalCost)}</strong> (${escapeHtml(params.startTime)} - ${escapeHtml(params.endTime)})
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

    // サマリーの表示
    const modeName = params.mode === 'night' 
        ? '🌜 深夜パック' 
        : `🌞 時間貸し (${Math.ceil((toMinutes(params.endTime) - toMinutes(params.startTime)) / 60)}時間利用)`;

    const summaryText = `
        ✨ <strong>${filteredStudios.length}件</strong>のスタジオが見つかりました (${targetDayOfWeek} ${modeName}) 
        <span class="summary-details">| 希望人数: ${params.people}名 / 必要面積: ${requiredArea}㎡ / 予算: ${params.price === Infinity ? '無制限' : formatPrice(params.price)}</span>
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
// 🔌 アプリケーション初期化処理
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

        // 深夜パックのテストのため、検索モードが'night'の場合に条件を上書き
        if (params.mode === 'night') {
            console.log("--- 深夜パック強制テストモード実行 ---");
            // 2025-11-11 は火曜日（平日）
            params.date = '2025-11-11';    
            params.price = 10000;         // 予算を高く設定
            params.people = 10;           // 人数を設定
            params.startTime = '23:00';   // 深夜パックの開始時間
            params.endTime = '06:00';     // 深夜パックの終了時間
        }
        // 【🚨 追記ここまで 🚨】
        
        // 📌 正常なバリデーション (無効な検索条件を防ぐ)
        if (params.people <= 0 || (params.mode === 'day' && (!params.date || params.startTime === params.endTime))) {
            document.getElementById('result').innerHTML = '<div class="no-results">無効な検索条件です。検索ページに戻り、人数または時間帯を指定してください。</div>';
            document.getElementById('searchSummary').textContent = '';
            return;
        }
        
        // データ読み込み
        const allStudios = await fetchLocalJson();
        
        // 【デバッグログ】件数確認
        console.log('--- 読み込まれたデータ件数 ---');
        console.log('件数:', allStudios.length); 

        // 検索実行
        const filteredStudios = runSearch(allStudios, params);
        
        // 結果表示
        // runSearchが既にrenderResultsを呼び出しているため、ここはコメントアウト
        // renderResults(filteredStudios, params);
        
    } catch (err) {
        console.error('データの読み込みまたは検索処理に失敗しました。', err);
        // JSONファイルの構文エラーが発生した場合のメッセージ
        document.getElementById('result').innerHTML = '<div class="error-message">データの読み込み中にエラーが発生しました。**data.jsonの構文**を確認してください。</div>';
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);