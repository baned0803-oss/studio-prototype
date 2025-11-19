// ==========================================
// 検索結果処理 (results.html用)
// ==========================================

import { CONFIG, SEARCH_MODE } from "./config.js";
import {
  toMinutes,
  formatPrice,
  escapeHtml,
  escapeAttr,
  getDayOfWeek,
  isNightPackRate,
  fetchData,
} from "./utils.js";

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
      const studioDays = rate.days_of_week.split(",").map((d) => d.trim());

      if (rate.days_of_week === "毎日") {
        dayMatches = true;
      } else if (studioDays.includes(targetDayOfWeek)) {
        dayMatches = true;
      } else if (
        studioDays.includes("平日") &&
        targetDayOfWeek !== "土曜" &&
        targetDayOfWeek !== "日曜"
      ) {
        dayMatches = true;
      } else if (
        studioDays.includes("土日祝") &&
        (targetDayOfWeek === "土曜" || targetDayOfWeek === "日曜")
      ) {
        dayMatches = true;
      }

      // 時間帯チェック
      const timeMatches =
        rateStartMin <= currentStartMin && currentStartMin < rateEndMin;

      if (dayMatches && timeMatches) {
        hourlyCost = rate.min_price;
        matchingRate = rate;
        break;
      }
    }

    if (hourlyCost === null) {
      console.warn(
        `料金設定が見つからない時間帯: ${currentStartMin}分 (${targetDayOfWeek})`
      );
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
        min_price: matchingRate.min_price,
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
  // 【修正】パラメータがあればそれを使い、なければデフォルト値を使う
  // ※ params.areaPerPerson は、フォームで選ばれた「利用スタイル」の係数
  const currentAreaPerPerson = params.areaPerPerson || CONFIG.AREA_PER_PERSON;
  const requiredArea = requestedPeople * currentAreaPerPerson;

  // ログで確認しておくと安心です
  console.log(
    `計算ロジック: ${requestedPeople}人 × ${currentAreaPerPerson}㎡ = 必要面積 ${requiredArea}㎡`
  );

  const totalDurationHours = Math.ceil((endMin - startMin) / 60);
  console.log("--- 実行ロジック確認 ---");
  console.log("計算された曜日:", targetDayOfWeek);
  console.log("必須面積:", requiredArea, "㎡");
  console.log("選択されたエリア:", selectedAreas);

  // 1. スタジオをroom_nameでグループ化
  const groupedStudios = allStudios.reduce((acc, current) => {
    const studioId =
      current.studio_id && current.studio_id !== "-"
        ? current.studio_id
        : current.studio_name;
    const roomId =
      current.room_id && current.room_id !== "-"
        ? current.room_id
        : current.room_name;
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
            rates: [],
          },
        },
      };
    }

    if (!acc[key].rooms[current.room_name]) {
      acc[key].rooms[current.room_name] = {
        room_name: current.room_name,
        area_sqm: current.area_sqm,
        recommended_max: current.recommended_max,
        notes: current.notes,
        rates: [],
      };
    }

    acc[key].rooms[current.room_name].rates.push(current);

    return acc;
  }, {});

  const uniqueStudios = Object.values(groupedStudios);
  const results = [];

  // 2. グループ化された各スタジオに対して検索条件を適用
  uniqueStudios.forEach((studio) => {
    // エリアフィルタリング
    if (selectedAreas.length > 0 && !selectedAreas.includes(studio.area)) {
      return;
    }

    Object.values(studio.rooms).forEach((room) => {
      // 面積チェック
      if (room.area_sqm == null || room.area_sqm < requiredArea) return;

      // 通常検索
      if (searchMode === SEARCH_MODE.DAY) {
        const { totalCost, appliedRates } = calculateTotalCost(
          room.rates,
          startMin,
          endMin,
          targetDayOfWeek
        );

        if (totalCost === null || totalCost > maxPrice) return;

        results.push({
          studio_name: studio.studio_name,
          studio_url: studio.official_url,
          studio_area: studio.area,
          room_name: room.room_name,
          room: room,
          totalCost: totalCost,
          appliedRates: appliedRates,
        });
      }

      // 深夜パック検索
      else if (searchMode === SEARCH_MODE.NIGHT) {
        let cheapestNightPack = null;
        let nightRate = null;

        (room.rates || []).forEach((rate) => {
          if (!isNightPackRate(rate)) return;

          let dayMatches = false;
          const studioDays = rate.days_of_week.split(",").map((d) => d.trim());

          if (rate.days_of_week === "毎日") {
            dayMatches = true;
          } else if (studioDays.includes(targetDayOfWeek)) {
            dayMatches = true;
          } else if (
            studioDays.includes("平日") &&
            targetDayOfWeek !== "土曜" &&
            targetDayOfWeek !== "日曜"
          ) {
            dayMatches = true;
          } else if (
            studioDays.includes("土日祝") &&
            (targetDayOfWeek === "土曜" || targetDayOfWeek === "日曜")
          ) {
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
            appliedRates: [
              {
                rate_name: nightRate.rate_name,
                start_time: nightRate.start_time,
                end_time: nightRate.end_time,
                min_price: nightRate.min_price,
              },
            ],
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
  const perPersonCost =
    requestedPeople > 0 ? totalCost / requestedPeople : null;

  // 部屋の面積チェック（数値のみ表示に変更）
  const roomArea = item.room.area_sqm;
  const requiredArea = params.people * (params.areaPerPerson || 5);

  // 条件を満たさない場合は文字色を変えるクラスだけ付与
  const areaFitClass =
    roomArea != null && roomArea >= requiredArea ? "" : "warning";
  const areaText = roomArea != null ? `${roomArea}㎡` : "未記載";

  const notes = item.room.notes || "特記事項なし";

  // 料金データ一覧の生成（変更なし）
  const uniqueAppliedRates = Array.from(
    new Set(
      item.appliedRates.map(
        (rate) => `${rate.start_time}-${rate.end_time}-${rate.min_price}`
      )
    )
  ).map((key) => {
    const rate = item.appliedRates.find(
      (r) => `${r.start_time}-${r.end_time}-${r.min_price}` === key
    );
    return rate;
  });

  const appliedRatesHtml = (uniqueAppliedRates || [])
    .map((rate) => {
      const isPack = isNightPackRate(rate);
      const priceText = isPack
        ? formatPrice(rate.min_price)
        : `${formatPrice(rate.min_price)}/h`;
      const timeRange = `${escapeHtml(rate.start_time)} - ${escapeHtml(
        rate.end_time
      )}`;

      return `
            <div class="rate-data-row">
                <span>| ${timeRange} |</span>
                <strong>${priceText}</strong>
            </div>
        `;
    })
    .join("");

  // 時間帯表示（深夜パックかどうかで分岐）
  const isNightPackMode = params.mode === SEARCH_MODE.NIGHT;
  const timeRangeText = isNightPackMode
    ? "深夜パック適用"
    : `${escapeHtml(params.startTime)} - ${escapeHtml(params.endTime)}`;

  // 💰 料金表示部分（縦並びにレイアウト変更）
  const costHtml = `
        <div class="cost-display" style="text-align: center; padding: 25px 15px;">
            <div class="total-cost-line" style="display: flex; flex-direction: column; gap: 5px; align-items: center;">
                <span style="font-size: 14px; color: #94a3b8; font-weight: 600;">💰 利用料金</span>
                <strong style="font-size: 42px; line-height: 1.1; color: #60a5fa; text-shadow: 0 2px 10px rgba(96, 165, 250, 0.2);">${formatPrice(
                  totalCost
                )}</strong>
                <span style="font-size: 14px; color: #cbd5e1; margin-top: 5px;">${timeRangeText}</span>
            </div>
        </div>
        ${
          perPersonCost !== null
            ? `<div class="per-person-cost-line" style="text-align:center; margin-top:-10px; margin-bottom:20px;">1人あたり: ${formatPrice(
                perPersonCost
              )}</div>`
            : ""
        }

        ${
          uniqueAppliedRates && uniqueAppliedRates.length > 0
            ? `
            <div class="rate-data-container">
                <strong>〇スタジオ料金データ</strong>
                ${appliedRatesHtml}
            </div>
        `
            : ""
        }
    `;

  // カードのHTML構造を生成
  return `
        <div class="result-card">
            <h2 class="card-title" style="display: flex; flex-direction: column; gap: 10px; align-items: flex-start;">
                <span class="studio-area-tag" style="font-size: 12px;">📍 ${escapeHtml(
                  item.studio_area
                )}</span>
                <div style="line-height: 1.4;">
                    <div style="font-size: 20px;">${escapeHtml(
                      item.studio_name
                    )}</div>
                    <div style="font-size: 15px; color: #94a3b8; font-weight: normal; margin-top: 4px;">${escapeHtml(
                      item.room_name
                    )}</div>
                </div>
            </h2>
            <div class="card-body">
                <div class="meta-item" style="justify-content: center; gap: 10px; border-bottom: none; padding-bottom: 0;">
                    <span style="font-size: 15px;">📐広さ</span>
                    <strong class="${areaFitClass}" style="font-size: 24px;">${escapeHtml(
    areaText
  )}</strong>
                </div>

                ${costHtml}

                <div class="meta-item notes-display">
                    <span>その他/備考</span>
                    <strong>${escapeHtml(notes)}</strong>
                </div>
            </div>
            <a href="${escapeAttr(
              item.studio_url || "#"
            )}" target="_blank" class="detail-link">
                <button>公式サイトで詳細を見る →</button>
            </a>
        </div>
    `;
}
/**
 * 検索結果の表示
 */
function renderResults(filteredStudios, params) {
  const resultElement = document.getElementById("result");
  const summaryElement = document.getElementById("searchSummary");

  const targetDayOfWeek = getDayOfWeek(params.date);
  const currentAreaPerPerson = params.areaPerPerson || 5;
  // 切り上げ計算して表示用面積を出す
  const requiredArea = Math.ceil(params.people * currentAreaPerPerson);

  const modeName =
    params.mode === SEARCH_MODE.NIGHT
      ? "🌜 深夜パック"
      : `🌞 時間貸し (${Math.ceil(
          (toMinutes(params.endTime) - toMinutes(params.startTime)) / 60
        )}時間利用)`;

  // 選択エリアの表示
  const areaText =
    params.areas && params.areas.length > 0
      ? params.areas.join(", ")
      : "すべてのエリア";

  const summaryText = `
        <div style="margin-bottom: 15px;">
            <span style="font-size: 28px; font-weight: bold;">✨ ${filteredStudios.length}件</span>
            <span style="font-size: 16px; font-weight: bold;">のスタジオが見つかりました</span>
        </div>
        
        <div style="
            margin-bottom: 20px; 
            color: #cbd5e1; 
            font-size: 15px; 
            display: flex; 
            justify-content: center; /* ← これで中央に寄ります！ */
            align-items: center; 
            gap: 15px; 
            flex-wrap: wrap;
        ">
            <span> ${params.date} (${targetDayOfWeek}) ${modeName}</span>
            
            <span style="font-size: 13px; color: #fbbf24; letter-spacing: 0.5px;">
                ⚠️ 祝日は公式サイトで料金要確認
            </span>
        </div>

        <div class="summary-details" style="
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 12px;
            padding: 15px 20px;
            display: inline-flex;
            flex-direction: column;
            gap: 10px;
            text-align: left;
            margin-left: 0; /* 既存CSSのリセット */
            max-width: 100%;
        ">
            <div style="font-size: 15px;">
                 エリア: <strong style="color: #fff;">${escapeHtml(
                  areaText
                )}</strong>
            </div>
            <div style="
                display: flex; 
                flex-wrap: wrap; 
                gap: 15px 20px; 
                border-top: 1px solid rgba(148, 163, 184, 0.2); 
                padding-top: 10px;
                font-size: 14px;
            ">
                <span>👥 人数: <strong style="color: #fff;">${
                  params.people
                }名</strong></span>
                <span>📐 必要面積: <strong style="color: #fff;">${requiredArea}㎡</strong></span>
                <span>💰 予算: <strong style="color: #fff;">${
                  params.price === Infinity
                    ? "無制限"
                    : formatPrice(params.price)
                }</strong></span>
            </div>
        </div>
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
    const grid = document.createElement("div");
    grid.className = "card-grid";

    filteredStudios.forEach((item) => {
      const cardHtml = createStudioCard(item, params);
      grid.innerHTML += cardHtml;
    });

    resultElement.innerHTML = "";
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

  // エリアパラメータを取得
  const areasParam = urlParams.get("areas") || "";
  const selectedAreas = areasParam ? areasParam.split(",") : [];

  return {
    date: urlParams.get("date") || "",
    startTime: urlParams.get("startTime") || "00:00",
    endTime: urlParams.get("endTime") || "00:00",
    // ▼ ここから下の行が消えていないか確認してください！ ▼
    price: Number(urlParams.get("price")) || Infinity,
    people: Number(urlParams.get("people")) || 0,
    mode: urlParams.get("mode") || SEARCH_MODE.DAY,
    areas: selectedAreas,
    // ▲ ここまで ▲
    areaPerPerson: Number(urlParams.get("usage")) || CONFIG.AREA_PER_PERSON,
  };
}

/**
 * アプリケーション初期化
 */
async function initializeApp() {
  try {
    const params = getSearchParams();

    // バリデーション (無効な検索条件を防ぐ)
    if (
      params.people <= 0 ||
      (params.mode === SEARCH_MODE.DAY &&
        (!params.date || params.startTime === params.endTime))
    ) {
      document.getElementById("result").innerHTML =
        '<div class="no-results">無効な検索条件です。検索ページに戻り、人数または時間帯を指定してください。</div>';
      document.getElementById("searchSummary").textContent = "";
      return;
    }

    // データ読み込み
    const allStudios = await fetchData(CONFIG.DATA_URL);

    console.log("--- 読み込まれたデータ件数 ---");
    console.log("件数:", allStudios.length);

    // 検索実行
    runSearch(allStudios, params);
  } catch (err) {
    console.error("データの読み込みまたは検索処理に失敗しました。", err);
    document.getElementById("result").innerHTML =
      '<div class="error-message">データの読み込み中にエラーが発生しました。**data.jsonの構文**を確認してください。</div>';
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
