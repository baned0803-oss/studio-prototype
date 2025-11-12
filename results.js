// ==========================================
// 📌 results.js - 検索ロジックと結果表示 (完全修正版)
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
    const days = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];
    return days[date.getDay()];
}

// ==========================================
// 💡 検索ロジック：時間帯をまたぐ検索対応 (修正版)
// ==========================================

/**
 * 検索条件を満たすスタジオを抽出し、利用可否と料金範囲を判定する
 * @param {Array<Object>} allStudios - data.json 全データ
 * @param {Object} params - 検索パラメータ
 * @returns {Array<Object>} - 検索条件を満たしたユニークなスタジオと価格情報
 */
function runSearch(allStudios, params) {
    const requiredArea = params.people * AREA_PER_PERSON;
    const userStartMinutes = toMinutes(params.startTime);
    const userEndMinutes = toMinutes(params.endTime);
    const dayOfWeek = getDayOfWeek(params.date);

    // 1. スタジオをroom_nameでグループ化
    const groupedStudios = allStudios.reduce((acc, current) => {
        // studio_idとroom_idをキーとして使用 (未入力の場合はnameを使用)
        const studioId = current.studio_id && current.studio_id !== '-' ? current.studio_id : current.studio_name;
        const roomId = current.room_id && current.room_id !== '-' ? current.room_id : current.room_name;
        const key = `${studioId}-${roomId}`;

        if (!acc[key]) {
            acc[key] = {
                studio_name: current.studio_name,
                room_name: current.room_name,
                official_url: current.official_url,
                area_sqm: current.area_sqm,
                recommended_max: current.recommended_max,
                rates: [],
                min_available_price: Infinity, // 最小価格の追跡用
                isAvailable: false,            // 利用可否フラグ
                matchingRates: []              // マッチした料金区分
            };
        }
        acc[key].rates.push(current);
        return acc;
    }, {});

    const uniqueStudios = Object.values(groupedStudios);

    // 2. グループ化された各スタジオに対して検索条件を適用
    const filteredStudios = uniqueStudios.filter(studio => {
        // 広さチェック
        if (studio.area_sqm < requiredArea) {
            return false;
        }

        let isTimeAndDayMatch = false;
        
        // 3. 各スタジオの料金区分をチェックし、時間帯のオーバーラップを探索
        studio.rates.forEach(rate => {
            const studioDays = rate.days_of_week.split(',').map(d => d.trim());
            const rateStartMinutes = toMinutes(rate.start_time);
            const rateEndMinutes = toMinutes(rate.end_time);

            // 曜日チェック
            if (!studioDays.includes(dayOfWeek) && rate.days_of_week !== '毎日') {
                // '毎日'はどの曜日にもマッチさせる
                return; // この料金区分は曜日不適合
            }

            // 【新ロジック】時間帯のオーバーラップをチェック (時間帯をまたぐ利用に対応)
            const overlapStart = Math.max(userStartMinutes, rateStartMinutes);
            const overlapEnd = Math.min(userEndMinutes, rateEndMinutes);
            
            // オーバーラップが存在し、かつユーザーの予算内であること
            if (overlapStart < overlapEnd && rate.min_price <= params.price) {
                isTimeAndDayMatch = true;
                
                // 利用可能な最小料金を更新
                studio.min_available_price = Math.min(studio.min_available_price, rate.min_price);
                
                // マッチした料金区分を保存
                studio.matchingRates.push(rate);
            }
        });

        // 4. 最終判定: 広さ、予算、そして時間帯/曜日をクリアしたか
        if (isTimeAndDayMatch && studio.min_available_price <= params.price) {
            studio.isAvailable = true;
            return true;
        }

        return false;
    });

    return filteredStudios;
}


// ==========================================
// 🖥️ 結果表示ロジック
// ==========================================

/**
 * スタジオの結果カードを作成
 */
function createStudioCard(studio) {
    // マッチした料金区分をユニークな名称で表示
    const uniqueRateNames = Array.from(new Set(
        studio.matchingRates.map(rate => 
            `${escapeHtml(rate.rate_name || '料金区分')} | ${escapeHtml(rate.start_time)} - ${escapeHtml(rate.end_time)} | ${formatPrice(rate.min_price)}/h`
        )
    ));
    
    const matchingRatesHtml = uniqueRateNames.map(rateText => `
        <span class="rate-tag">${rateText}</span>
    `).join('');

    const minPriceDisplay = studio.min_available_price !== Infinity 
        ? formatPrice(studio.min_available_price) 
        : '要問合せ';

    return `
        <div class="result-card">
            <h2 class="card-title">${escapeHtml(studio.studio_name)} (${escapeHtml(studio.room_name)})</h2>
            <div class="card-body">
                <p class="card-area">
                    <span class="icon">📐</span> 広さ: <strong>${studio.area_sqm}㎡</strong> 
                    <span class="note">(推奨最大人数: ${studio.recommended_max}人)</span>
                </p>
                <p class="card-price">
                    <span class="icon">💰</span> 最低料金: <strong>${minPriceDisplay}</strong> /時間
                </p>
                
                <div class="rate-details">
                    <h3>マッチした料金区分</h3>
                    <div class="rate-tags-container">
                        ${matchingRatesHtml || '<p class="no-rate-match">検索時間帯にマッチする料金区分が見つかりませんでした。</p>'}
                    </div>
                </div>

                <div class="card-footer">
                    <a href="${escapeAttr(studio.official_url)}" target="_blank" class="detail-link">
                        公式サイトで詳細を見る →
                    </a>
                </div>
            </div>
        </div>
    `;
}

/**
 * 検索結果の表示
 */
function renderResults(filteredStudios, params) {
    const resultElement = document.getElementById('result');
    const summaryElement = document.getElementById('searchSummary');

    const requiredArea = params.people * AREA_PER_PERSON;
    
    // サマリーの表示
    const summaryText = `
        ${params.date} (${getDayOfWeek(params.date)}) / ${params.startTime} - ${params.endTime} / 
        人数: ${params.people}人 / 必須面積: ${requiredArea}㎡ / 
        予算: ${params.price === Infinity ? '無制限' : formatPrice(params.price)}
    `;
    summaryElement.textContent = summaryText;

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
        const resultsHtml = filteredStudios.map(createStudioCard).join('');
        resultElement.innerHTML = resultsHtml;
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
        
        // バリデーション
        if (params.people <= 0 || (!params.date || params.startTime === params.endTime)) {
            document.getElementById('result').innerHTML = '<div class="no-results">無効な検索条件です。検索ページに戻り、人数または時間帯を指定してください。</div>';
            document.getElementById('searchSummary').textContent = '';
            return;
        }
        
        // データ読み込み
        const allStudios = await fetchLocalJson();
        
        // 検索実行
        const filteredStudios = runSearch(allStudios, params);
        
        // 結果表示
        renderResults(filteredStudios, params);
        
    } catch (err) {
        console.error('データの読み込みまたは検索処理に失敗しました。', err);
        // JSONファイルの構文エラーが発生した場合のメッセージ
        document.getElementById('result').innerHTML = '<div class="error-message">データの読み込み中にエラーが発生しました。**data.jsonの構文**を確認してください。</div>';
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);