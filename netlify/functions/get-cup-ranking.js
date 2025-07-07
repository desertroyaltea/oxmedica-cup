const { google } = require('googleapis');

async function getWeeklyData(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
    const rows = response.data.values || [];
    if (rows.length < 4) return [];
    
    const eventHeaderRow = rows[0];
    const data = [];
    const pointColumnIndices = [];

    for (let i = 3; i < eventHeaderRow.length; i++) {
        if ((eventHeaderRow[i] || '').trim().toLowerCase() === 'ra points') {
            pointColumnIndices.push(i);
        }
    }

    for (let i = 3; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[1] || !row[2]) continue;
        const name = row[1].trim();
        const group = row[2].trim();
        let totalPoints = 0;
        for (const colIndex of pointColumnIndices) {
            const points = parseInt(row[colIndex] || '0');
            if (!isNaN(points)) totalPoints += points;
        }
        data.push({ name, group, points });
    }
    return data;
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }
    try {
        const { type } = JSON.parse(event.body); // No longer needs 'week'
        if (!type) { return { statusCode: 400, body: JSON.stringify({ message: 'Type not specified.' }) }; }

        const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), }, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'], });
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        const weekSheets = ['Week2', 'Week3']; // Always calculate total
        let aggregatedData = [];
        for (const sheetName of weekSheets) {
            const weeklyData = await getWeeklyData(sheets, spreadsheetId, sheetName);
            aggregatedData = aggregatedData.concat(weeklyData);
        }

        let finalPoints = {};

        if (type === 'group') {
            const studentTotals = {};
            for (const item of aggregatedData) {
                if (!studentTotals[item.name]) {
                    studentTotals[item.name] = { points: 0, group: item.group };
                }
                studentTotals[item.name].points += item.points;
            }
            const groupData = {};
            for (const studentName in studentTotals) {
                const student = studentTotals[studentName];
                if (student.group) {
                    if (!groupData[student.group]) {
                        groupData[student.group] = { totalPoints: 0, studentCount: 0 };
                    }
                    groupData[student.group].totalPoints += student.points;
                    groupData[student.group].studentCount += 1;
                }
            }
            for (const groupName in groupData) {
                const group = groupData[groupName];
                if (group.studentCount > 0) {
                    finalPoints[groupName] = Math.round(group.totalPoints * (7 / group.studentCount));
                }
            }
        } else if (type === 'ra') {
            for (const item of aggregatedData) {
                // An RA's row is where their name and group name are the same
                if (item.name === item.group) {
                    finalPoints[item.name] = (finalPoints[item.name] || 0) + item.points;
                }
            }
        } else { // Student ranking
            for (const item of aggregatedData) {
                // Exclude RAs from the student ranking
                if (item.name !== item.group) {
                    finalPoints[item.name] = (finalPoints[item.name] || 0) + item.points;
                }
            }
        }

        const rankedList = Object.entries(finalPoints).map(([name, points]) => ({ name, points })).sort((a, b) => b.points - a.points);
        return { statusCode: 200, body: JSON.stringify(rankedList), };
    } catch (error) {
        console.error('Function Error:', error);
        return { statusCode: 500, body: JSON.stringify({ message: `An error occurred: ${error.message}` }), };
    }
};
