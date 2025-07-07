const { google } = require('googleapis');

// A single, robust helper function to get all relevant data from a sheet.
async function getWeeklyData(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName, // Read the whole sheet
    });

    const rows = response.data.values || [];
    if (rows.length < 4) return []; // Not enough data to process

    const eventHeaderRow = rows[0];
    const data = [];
    
    // Find all columns that are 'RA Points'
    const pointColumnIndices = [];
    for (let i = 0; i < eventHeaderRow.length; i++) {
        if ((eventHeaderRow[i] || '').trim().toLowerCase() === 'ra points') {
            pointColumnIndices.push(i);
        }
    }

    // Iterate through all data rows (starting from row 4, which is index 3)
    for (let i = 3; i < rows.length; i++) {
        const row = rows[i];
        // A valid entry must have a name (col B) and a group (col C)
        if (!row || !row[1] || !row[2]) continue;

        const name = row[1].trim();
        const group = row[2].trim();
        let totalPoints = 0;

        // Sum points for this entry from all 'RA Points' columns
        for (const colIndex of pointColumnIndices) {
            const points = parseInt(row[colIndex] || '0');
            if (!isNaN(points)) {
                totalPoints += points;
            }
        }
        data.push({ name, group, points: totalPoints });
    }
    return data;
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }

    try {
        const { type } = JSON.parse(event.body);
        if (!type) { return { statusCode: 400, body: JSON.stringify({ message: 'Ranking type not specified.' }) }; }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // Always calculate total across all relevant weeks
        const weekSheets = ['Week2', 'Week3']; // Add more weeks here if needed
        let aggregatedData = [];
        for (const sheetName of weekSheets) {
            const weeklyData = await getWeeklyData(sheets, spreadsheetId, sheetName);
            aggregatedData = aggregatedData.concat(weeklyData);
        }

        let finalPoints = {};

        if (type === 'group') {
            const groupAggregates = {};
            for (const item of aggregatedData) {
                if (!groupAggregates[item.group]) {
                    groupAggregates[item.group] = { totalPoints: 0, members: new Set() };
                }
                groupAggregates[item.group].totalPoints += item.points;
                groupAggregates[item.group].members.add(item.name);
            }
            for (const groupName in groupAggregates) {
                const group = groupAggregates[groupName];
                const studentCount = group.members.size;
                if (studentCount > 0) {
                    finalPoints[groupName] = Math.round(group.totalPoints * (7 / studentCount));
                }
            }
        } else {
            // This handles both 'student' and 'ra' types
            for (const item of aggregatedData) {
                const isRA = item.name === item.group;
                if ((type === 'ra' && isRA) || (type === 'student' && !isRA)) {
                    finalPoints[item.name] = (finalPoints[item.name] || 0) + item.points;
                }
            }
        }

        const rankedList = Object.entries(finalPoints)
            .map(([name, points]) => ({ name, points }))
            .sort((a, b) => b.points - a.points);

        return {
            statusCode: 200,
            body: JSON.stringify(rankedList),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `An error occurred: ${error.message}` }),
        };
    }
};
