const { google } = require('googleapis');

// This function now returns a more detailed object with total points and student counts for each group.
async function getWeeklyGroupData(sheets, spreadsheetId, sheetName) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: sheetName, // Read the whole sheet
    });

    const rows = response.data.values || [];
    if (rows.length < 4) {
        return {}; // Not enough data to process
    }

    const eventHeaderRow = rows[0];
    const groupData = {};

    // Find all columns that are 'RA Points'
    const pointColumnIndices = [];
    for (let i = 3; i < eventHeaderRow.length; i++) {
        if ((eventHeaderRow[i] || '').trim().toLowerCase() === 'ra points') {
            pointColumnIndices.push(i);
        }
    }

    // Iterate through all possible student rows to build a complete roster and point total for each group
    for (let i = 3; i < rows.length; i++) {
        const studentRow = rows[i];
        // A student must have a name (col B) and a group (col C) to be counted
        if (!studentRow || !studentRow[1] || !studentRow[2]) continue;

        const studentName = studentRow[1].trim();
        const raGroup = studentRow[2].trim();

        // Initialize the group if it's the first time we see it
        if (!groupData[raGroup]) {
            groupData[raGroup] = { totalPoints: 0, studentCount: 0, members: new Set() };
        }

        // Add the student to the group's member list to count unique students
        groupData[raGroup].members.add(studentName);

        // Sum this student's points for the week
        let studentWeeklyPoints = 0;
        for (const colIndex of pointColumnIndices) {
            const points = parseInt(studentRow[colIndex] || '0');
            if (!isNaN(points)) {
                studentWeeklyPoints += points;
            }
        }
        
        // Add the student's weekly points to their group's total
        groupData[raGroup].totalPoints += studentWeeklyPoints;
    }

    // Finalize the student count for each group
    for (const groupName in groupData) {
        groupData[groupName].studentCount = groupData[groupName].members.size;
        delete groupData[groupName].members; // Clean up the temporary set
    }
    
    return groupData;
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

        let finalResults = {};

        if (week.toLowerCase() === 'total') {
            const weekSheets = ['Week2', 'Week3']; // Add other weeks as needed
            const totalData = {};

            for(const sheetName of weekSheets) {
                const weeklyGroupData = await getWeeklyGroupData(sheets, spreadsheetId, sheetName);
                for (const groupName in weeklyGroupData) {
                    if (!totalData[groupName]) {
                        totalData[groupName] = { totalPoints: 0, studentCount: 0 };
                    }
                    totalData[groupName].totalPoints += weeklyGroupData[groupName].totalPoints;
                    // The student count should be taken from a master list or the last week, assuming it's stable.
                    // For this logic, we'll use the count from the last processed week for that group.
                    totalData[groupName].studentCount = weeklyGroupData[groupName].studentCount;
                }
            }
            finalResults = totalData;
        } else {
            finalResults = await getWeeklyGroupData(sheets, spreadsheetId, week);
        }

        let rankedList;

        if (type === 'group') {
            const groupScores = [];
            for (const groupName in finalResults) {
                const group = finalResults[groupName];
                if (group.studentCount > 0) {
                    const adjustedScore = Math.round(group.totalPoints * (7 / group.studentCount));
                    groupScores.push({ name: groupName, points: adjustedScore });
                }
            }
            rankedList = groupScores.sort((a, b) => b.points - a.points);
        } else { // Student ranking
            // For student totals, we need to re-aggregate across all weeks if 'Total' is selected
            const studentPoints = {};
            const allStudentData = [];
            const sheetsToProcess = week.toLowerCase() === 'total' ? ['Week2', 'Week3'] : [week];
            
            for(const sheetName of sheetsToProcess) {
                const weeklyStudentData = await calculateSheetData(sheets, spreadsheetId, sheetName); // A simplified version for student points
                allStudentData.push(...weeklyStudentData);
            }

            for(const student of allStudentData){
                studentPoints[student.name] = (studentPoints[student.name] || 0) + student.points;
            }
            rankedList = Object.entries(studentPoints)
                .map(([name, points]) => ({ name, points }))
                .sort((a, b) => b.points - a.points);
        }

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

// A separate, simplified function is needed for the student ranking part of the 'Total' calculation
async function calculateSheetData(sheets, spreadsheetId, sheetName) {
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
