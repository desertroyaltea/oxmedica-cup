const { google } = require('googleapis');

// This function gets the pre-calculated group scores from the "Total Points" column
async function getWeeklyGroupScores(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName, // Read the whole sheet
    });

    const rows = response.data.values || [];
    if (rows.length < 4) return {};

    const eventHeaderRow = rows[0];
    const groupScores = {};
    const processedGroups = new Set();

    // Find the "Total Points" column index
    const totalPointsColIndex = eventHeaderRow.findIndex(header => (header || '').trim().toLowerCase() === 'total points');
    if (totalPointsColIndex === -1) {
        // If the column doesn't exist, we can't calculate group scores this way
        console.error(`"Total Points" column not found in ${sheetName}`);
        return {};
    }

    // Iterate through student rows to find the first entry for each group
    for (let i = 3; i < rows.length; i++) {
        const studentRow = rows[i];
        if (!studentRow || !studentRow[2]) continue; // Skip if no RA group

        const raGroup = studentRow[2].trim();

        // If we haven't processed this group yet, get its score
        if (!processedGroups.has(raGroup)) {
            const points = parseInt(studentRow[totalPointsColIndex] || '0');
            if (!isNaN(points)) {
                groupScores[raGroup] = points;
            }
            processedGroups.add(raGroup); // Mark this group as processed
        }
    }
    return groupScores;
}

// This function calculates individual student points
async function calculateStudentSheetData(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
    const rows = response.data.values || [];
    if (rows.length < 4) return [];
    
    const eventHeaderRow = rows[0];
    const studentData = [];
    const pointColumnIndices = [];

    for (let i = 3; i < eventHeaderRow.length; i++) {
        if ((eventHeaderRow[i] || '').trim().toLowerCase() === 'ra points') {
            pointColumnIndices.push(i);
        }
    }

    for (let i = 3; i < rows.length; i++) {
        const studentRow = rows[i];
        if (!studentRow || !studentRow[1]) continue;
        const studentName = studentRow[1].trim();
        let totalPoints = 0;
        for (const colIndex of pointColumnIndices) {
            const points = parseInt(studentRow[colIndex] || '0');
            if (!isNaN(points)) totalPoints += points;
        }
        studentData.push({ name: studentName, points: totalPoints });
    }
    return studentData;
}


exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { week, type } = JSON.parse(event.body);
        if (!week || !type) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Week or type not specified.' }) };
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        let finalPoints = {};

        if (type === 'group') {
            if (week.toLowerCase() === 'total') {
                const weekSheets = ['Week2', 'Week3']; // Add other weeks here as needed
                for (const sheetName of weekSheets) {
                    const weeklyGroupScores = await getWeeklyGroupScores(sheets, spreadsheetId, sheetName);
                    for (const groupName in weeklyGroupScores) {
                        finalPoints[groupName] = (finalPoints[groupName] || 0) + weeklyGroupScores[groupName];
                    }
                }
            } else {
                finalPoints = await getWeeklyGroupScores(sheets, spreadsheetId, week);
            }
        } else { // Student ranking
            const sheetsToProcess = week.toLowerCase() === 'total' ? ['Week2', 'Week3'] : [week];
            for (const sheetName of sheetsToProcess) {
                const weeklyStudentData = await calculateStudentSheetData(sheets, spreadsheetId, sheetName);
                for (const student of weeklyStudentData) {
                    finalPoints[student.name] = (finalPoints[student.name] || 0) + student.points;
                }
            }
        }

        // Convert the final points map to an array and sort it
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
