// ==========================================
// スタジオ一覧ページ用スクリプト (シンプル版)
// ==========================================

import { CONFIG } from './config.js';
import { fetchData, escapeHtml, escapeAttr } from './utils.js';

async function initSimpleList() {
    const container = document.getElementById('simple-list-container');

    try {
        const allStudios = await fetchData(CONFIG.DATA_URL);

        // エリアごとにスタジオ名をまとめる（重複排除）
        const areaGroups = {};
        
        allStudios.forEach(record => {
            const area = record.area;
            const name = record.studio_name;
            const url = record.official_url;

            if (!areaGroups[area]) {
                areaGroups[area] = new Map(); // 名前をキーにして重複を防ぐ
            }
            
            // まだそのエリアに登録されていないスタジオ名なら追加
            if (!areaGroups[area].has(name)) {
                areaGroups[area].set(name, url);
            }
        });

        // 表示順序の定義
        const areaOrder = ["新宿", "渋谷", "池袋", "高円寺", "中野", "上野", "錦糸町", "市川", "その他"];

        // エリア順にソート
        const sortedAreas = Object.keys(areaGroups).sort((a, b) => {
            const idxA = areaOrder.indexOf(a);
            const idxB = areaOrder.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        // HTML生成
        let htmlContent = '';

        sortedAreas.forEach(area => {
            const studiosMap = areaGroups[area];
            
            htmlContent += `
                <div class="simple-area-section">
                    <h2 class="simple-area-title">${escapeHtml(area)}エリア</h2>
                    <ul class="simple-studio-list">
            `;
            
            // スタジオ名のリスト生成
            studiosMap.forEach((url, name) => {
                htmlContent += `
                    <li>
                        <a href="${escapeAttr(url)}" target="_blank">${escapeHtml(name)}</a>
                    </li>
                `;
            });

            htmlContent += `
                    </ul>
                </div>
            `;
        });

        container.innerHTML = htmlContent;

    } catch (err) {
        console.error(err);
        container.innerHTML = '<p style="color:#fca5a5;">データの読み込みに失敗しました。</p>';
    }
}

document.addEventListener('DOMContentLoaded', initSimpleList);