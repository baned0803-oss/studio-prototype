// ==========================================
// 検索結果処理 (results.html用)
// ==========================================

import { CONFIG, SEARCH_MODE } from './config.js';
import { toMinutes, formatPrice, escapeHtml, escapeAttr, getDayOfWeek, isNightPackRate, fetchData } from './utils.js';

// ==========================================
// 料金計算ロジック
// ==========================================

/**
 * 1時間ごとに料金を計算し、総額と適用料金区分を返す
 */
function calculateTotalCost(rates, startMin, endMin, targetDayOfWeek) {
    let totalCost = 0;
    const appliedRates = [];
    const appliedRateKeys = new Set();
    
    const totalHours = Math.ceil((endMin - startMin) / 60);

    for (let hour = 0; hour < totalHours; hour++) {
        const currentStartMin = startMin + hour * 60;
        
        if (currentStartMin >= endMin) continue;

        let hourlyCost = null;
        let matchingRate = null;

        for (const rate of rates) {
            if (isNightPackRate(rate)) continue;
            
            const rateStartMin = toMinutes(rate.start_time);
            const rateEndMin = toMinutes(rate.end_time);
            
            // 曜日チェック
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
            
            // 時間帯チェック
            const timeMatches = (rateStartMin <= currentStartMin && currentStartMin < rateEndMin);

            if (dayMatches && timeMatches) {
                hourlyCost = rate.min_price;
                matchingRate = rate;
                break;
            }
        }

        if (hourlyCost === null) {
            console.warn(`料金設定が見つからない時間帯: ${currentStartMin}分 (${targetDayOfWeek})`);
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
// 検索ロジック
// ==========================================

/**
 * 検索条件を満たすスタジオを抽出
 */
function runSearch(allStudios, params) {
    const dateStr = params.date;
    const startMin = toMinutes(params.startTime);
    const endMin = toMinutes(params.endTime);
    const maxPrice = params.price;
    const requestedPeople = params.people;
    const searchMode = params.mode;
    const selectedAreas = params.areas;

    const targetDayOfWeek = getDayOfWeek(dateStr);
    const requiredArea = requestedPeople * CONFIG.AREA_PER_PERSON;
    const totalDurationHours = Math.ceil((endMin - startMin) / 60);

    console.log('--- 実行ロジック確認 ---');
    console.log('計算された曜日:', targetDayOfWeek);
    console.log('必須面積:', requiredArea, '㎡');
    console.log('選択されたエリア:', selectedAreas);

    // 1. スタジオをroom_nameでグループ化
    const groupedStudios = allStudios.reduce((acc, current) => {
        const studioId = current.studio_id && current.studio_id !== '-' ? current.studio_id : current.studio_name;
        const roomId = current.room_id && current.room_id !== '-' ? current.room_id : current.room_name;
        const key = `${studioId}-${roomId}`;

        if (!acc[key]) {
            acc[key] = {
                studio_name: current.studio_name,
                official_url: current.official_url,
                area: current.area,
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
        
        if (!acc[key].rooms[current.room_name]) {
            acc[key].rooms[current.room_name] = {
                room_name: current.room_name,
                area_sqm: current.area_sqm,
                recommended_max: current.recommended_max,
                notes: current.notes,
                rates: []
            };
        }
        
        acc[key].rooms[current.room_name].rates.push(current);
        
        return acc;
    }, {});

    const uniqueStudios = Object.values(groupedStudios);
    const results = [];

    // 2. グループ化された各スタジオに対して検索条件を適用
    uniqueStudios.forEach(studio => {
        // エリアフィルタリング
        if (selectedAreas.length > 0 && !selectedAreas.includes(studio.area)) {
            return;
        }
        
        Object.values(studio.rooms).forEach(room => {
            // 面積チェック
            if (room.area_sqm == null || room.area_sqm < requiredArea) return;

            // 通常検索
            if (searchMode === SEARCH_MODE.DAY) {
                const { totalCost, appliedRates } = calculateTotalCost(room.rates, startMin, endMin, targetDayOfWeek);
                
                if (totalCost === null || totalCost > maxPrice) return;

                results.push({
                    studio_name: studio.studio_name,
                    studio_url: studio.official_url,
                    studio_area: studio.area,
                    room_name: room.room_name,
                    room: room,
                    totalCost: totalCost,
                    appliedRates: appliedRates
                });
            }
            
            // 深夜パック検索
            else if (searchMode === SEARCH_MODE.NIGHT) {
                let cheapestNightPack = null;
                let nightRate = null;
                
                (room.rates || []).forEach(rate => {
                    if (!isNightPackRate(rate)) return;
                    
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
                            nightRate = rate;
                        }
                    }
                });
                
                if (cheapestNightPack !== null) {
                    results.push({
                        studio_name: studio.studio_name,
                        studio_url: studio.official_url,
                        studio_area: studio.area,
                        room_name: room.room_name,
                        room: room,
                        totalCost: cheapestNightPack,
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

    // 総額が安い順にソート
    results.sort((a, b) => {
        return (a.totalCost ?? Infinity) - (b.totalCost ?? Infinity);
    });

    // 結果表示
    renderResults(results, params);
}

// ==========================================
// 結果表示ロジック
// ==========================================

/**
 * スタジオの結果カードを作成
 */
function createStudioCard(item, params) {
    // 総額と1人あたり金額を計算
    const totalCost = item.totalCost;
    const requestedPeople = params.people;
    const perPersonCost = requestedPeople > 0
        ? totalCost / requestedPeople
        : null;
    
    // 部屋の面積チェック
    const roomArea = item.room.area_sqm;
    const requiredArea = params.people * CONFIG.AREA_PER_PERSON;
    
    const areaFitStatus = roomArea != null && roomArea >= requiredArea
        ? `適合 (${roomArea}㎡)`
        : `**注意** (${roomArea ?? '未記載'}㎡)`;
    const areaFitClass = roomArea != null && roomArea >= requiredArea ? '' : 'warning';
    
    const notes = item.room.notes || '特記事項なし';
    
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

    // 深夜パックの場合は時間表示を省略
    const isNightPackMode = params.mode === SEARCH_MODE.NIGHT;
    const timeRangeText = isNightPackMode
        ? ''
        : ` (${escapeHtml(params.startTime)} - ${escapeHtml(params.endTime)})`;

    const costHtml = `
        <div class="cost-display">
            <div class="total-cost-line">
                💰利用料金: <strong>${formatPrice(totalCost)}</strong>${timeRangeText}
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
            <h2 class="card-title">
                <span class="studio-area-tag">📍 ${escapeHtml(item.studio_area)}</span>
                ${escapeHtml(item.studio_name)} (${escapeHtml(item.room_name)})
            </h2>
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
    const requiredArea = params.people * CONFIG.AREA_PER_PERSON;

    const modeName = params.mode === SEARCH_MODE.NIGHT
        ? '🌜 深夜パック'
        : `🌞 時間貸し (${Math.ceil((toMinutes(params.endTime) - toMinutes(params.startTime)) / 60)}時間利用)`;

    // 選択エリアの表示
    const areaText = params.areas && params.areas.length > 0
        ? params.areas.join(', ')
        : 'すべてのエリア';

    const summaryText = `
        ✨ <strong>${filteredStudios.length}件</strong>のスタジオが見つかりました (${targetDayOfWeek} ${modeName})
        <span class="summary-details">
            | エリア: ${escapeHtml(areaText)} 
            | 希望人数: ${params.people}名 
            | 必要面積: ${requiredArea}㎡ 
            | 予算: ${params.price === Infinity ? '無制限' : formatPrice(params.price)}
        </span>
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
        // カードをグリッド表示
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
// アプリケーション初期化処理
// ==========================================

/**
 * URLパラメータから検索条件を取得
 */
function getSearchParams() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // エリアパラメータを取得(カンマ区切り文字列を配列に変換)
    const areasParam = urlParams.get('areas') || '';
    const selectedAreas = areasParam ? areasParam.split(',') : [];
    
    return {
        date: urlParams.get('date') || '',
        startTime: urlParams.get('startTime') || '00:00',
        endTime: urlParams.get('endTime') || '00:00',
        price: Number(urlParams.get('price')) || Infinity,
        people: Number(urlParams.get('people')) || 0,
        mode: urlParams.get('mode') || SEARCH_MODE.DAY,
        areas: selectedAreas
    };
}

/**
 * アプリケーション初期化
 */
async function initializeApp() {
    try {
        const params = getSearchParams();
        
        // バリデーション (無効な検索条件を防ぐ)
        if (params.people <= 0 || (params.mode === SEARCH_MODE.DAY && (!params.date || params.startTime === params.endTime))) {
            document.getElementById('result').innerHTML = '<div class="no-results">無効な検索条件です。検索ページに戻り、人数または時間帯を指定してください。</div>';
            document.getElementById('searchSummary').textContent = '';
            return;
        }
        
        // データ読み込み
        const allStudios = await fetchData(CONFIG.DATA_URL);
        
        console.log('--- 読み込まれたデータ件数 ---');
        console.log('件数:', allStudios.length);

        // 検索実行
        runSearch(allStudios, params);
        
    } catch (err) {
        console.error('データの読み込みまたは検索処理に失敗しました。', err);
        document.getElementById('result').innerHTML = '<div class="error-message">データの読み込み中にエラーが発生しました。**data.jsonの構文**を確認してください。</div>';
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);