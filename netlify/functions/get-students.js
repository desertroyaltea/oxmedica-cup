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
        
        // Assuming the primary student list is in Week2, column B, starting from row 4
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Week2!B4:B', 
        });

        const rows = response.data.values || [];
        // Flatten the array, filter out any empty rows, and then sort alphabetically
        const studentNames = rows.flat().filter(name => name).sort();

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
