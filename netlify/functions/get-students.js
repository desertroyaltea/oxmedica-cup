const { google } = require('googleapis');

exports.handler = async function (event) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;

        // 1. Get all RA names to use for filtering
        const raResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'RAs!A:A',
        });
        const raNames = new Set((raResponse.data.values || []).flat());

        // 2. Get all names from a master week sheet (e.g., Week2)
        const studentResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Week2!B4:B',
        });
        const allNames = studentResponse.data.values || [];

        // 3. Filter out the RAs to get only the student names, then sort
        const studentNames = allNames
            .flat()
            .filter(name => name && !raNames.has(name.trim()))
            .sort();

        return {
            statusCode: 200,
            body: JSON.stringify(studentNames),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `An error occurred while fetching students: ${error.message}` }),
        };
    }
};
