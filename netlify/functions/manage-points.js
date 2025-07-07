const { google } = require('googleapis');

function toA1(colIndex) { let column = ""; let temp = colIndex + 1; while (temp > 0) { let mod = (temp - 1) % 26; column = String.fromCharCode(65 + mod) + column; temp = Math.floor((temp - 1) / 26); } return column; }
function formatDate(date) { const year = date.getFullYear(); const month = (date.getMonth() + 1).toString().padStart(2, '0'); const day = date.getDate().toString().padStart(2, '0'); return `${year}-${month}-${day}`; }

function getWeekSheetName(currentDate) {
    const week3_start = new Date(2025, 6, 13); // July 13
    const week2_start = new Date(2025, 6, 6);  // July 6
    if (currentDate >= week3_start) return 'Week3';
    if (currentDate >= week2_start) return 'Week2';
    return 'Week2'; // Default or fallback
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }
  try {
    const { studentName, points, action, reason, raName } = JSON.parse(event.body);
    const saudiTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const todayString = formatDate(saudiTime);
    const currentWeekSheet = getWeekSheetName(saudiTime);
    const coordinators = ['Saud', 'Aban', 'Sultan'];
    const isGiverCoordinator = coordinators.includes(raName);

    const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_CLIENT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), }, scopes: ['https://www.googleapis.com/auth/spreadsheets'], });
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const allRaResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'RAs!A:A' });
    const allRaNames = new Set((allRaResponse.data.values || []).flat());
    const isReceiverRA = allRaNames.has(studentName);

    if (!isGiverCoordinator && isReceiverRA) {
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: "RAs can only award points to students." }) };
    }

    const raSheetName = 'RAs';
    const raData = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${raSheetName}!A:B`, });
    const raRows = raData.data.values || [];
    const raRowIndex = raRows.findIndex(row => row && row[0] === raName);

    if (raRowIndex === -1) { return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `RA '${raName}' not found.` }) }; }
    const currentRaBalance = parseInt(raRows[raRowIndex][1] || '0');
    if (currentRaBalance < points) { return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Insufficient balance. You have ${currentRaBalance} points.` }) }; }
    
    const newRaBalance = currentRaBalance - points;
    const raCellToUpdate = `B${raRowIndex + 1}`;
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${raSheetName}!${raCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[newRaBalance]] }, });

    const weekData = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${currentWeekSheet}` });
    const rows = weekData.data.values || [];
    const eventHeaderRow = rows[0];
    const dateHeaderRow = rows[1];

    let targetColumnIndex = -1;
    for (let i = 0; i < eventHeaderRow.length; i++) {
        if (((eventHeaderRow[i] || '').trim().toLowerCase() === 'ra points') && (dateHeaderRow[i] ? formatDate(new Date(dateHeaderRow[i])) : null) === todayString) {
            targetColumnIndex = i;
            break;
        }
    }

    if (targetColumnIndex === -1) {
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${raSheetName}!${raCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[currentRaBalance]] } });
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Could not find 'RA Points' column for today in ${currentWeekSheet}.` }) };
    }

    let targetRowIndex = -1;
    for (let i = 3; i < rows.length; i++) {
        if (rows[i] && (rows[i][1] || '').trim() === studentName) {
            targetRowIndex = i;
            break;
        }
    }

    if (targetRowIndex === -1) {
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${raSheetName}!${raCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[currentRaBalance]] } });
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: `Target '${studentName}' not found in ${currentWeekSheet}.` }) };
    }

    const studentRaGroupName = (rows[targetRowIndex][2] || '').trim();
    
    // --- NEW: Updated permissions logic ---
    // An RA cannot ADD points to their own students, but they CAN remove them.
    if (!isGiverCoordinator && studentRaGroupName === raName && action === 'add') {
        // Refund points because this action is invalid.
        await sheets.spreadsheets.values.update({ spreadsheetId, range: `${raSheetName}!${raCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[currentRaBalance]] } });
        return { statusCode: 200, body: JSON.stringify({ status: 'error', message: "You cannot ADD points to students in your own group." }) };
    }
    // --- End of new check ---

    const studentRaGroupForLog = `RA ${studentRaGroupName}'s Group`;
    const currentStudentPoints = parseInt(rows[targetRowIndex][targetColumnIndex] || '0');
    let pointsChange = action === 'add' ? points : -points;
    const newStudentPoints = currentStudentPoints + pointsChange;

    const studentCellToUpdate = toA1(targetColumnIndex) + (targetRowIndex + 1);
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${currentWeekSheet}!${studentCellToUpdate}`, valueInputOption: 'USER_ENTERED', resource: { values: [[newStudentPoints]] } });

    if (!isGiverCoordinator && !isReceiverRA) {
        const pointsLogSheetName = 'Points';
        const dateForLog = saudiTime.toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh' });
        let recorderDisplayName = `RA ${raName}`;
        
        const pointsLogData = [
            dateForLog, 
            studentName, 
            recorderDisplayName,
            pointsChange > 0 ? `+${pointsChange}` : pointsChange.toString(), 
            reason, 
            studentRaGroupForLog
        ];
        
        await sheets.spreadsheets.values.append({ spreadsheetId, range: pointsLogSheetName, valueInputOption: 'USER_ENTERED', resource: { values: [pointsLogData] } });
    }
    
    const actionVerb = action === 'add' ? 'Added' : 'Removed';
    const successMessage = `${actionVerb} ${points} points for ${studentName}!`;
    return { statusCode: 200, body: JSON.stringify({ status: 'success', message: successMessage }), };
  } catch (error) {
    console.error('Function Error:', error);
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: `An error occurred: ${error.message}` }), };
  }
};
