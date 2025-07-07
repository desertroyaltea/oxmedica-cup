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

        // Fetches all names from Column A of the RAs sheet, starting from row 2
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'RAs!A2:A',
        });

        const raNames = (response.data.values || []).flat().filter(name => name).sort();

        return {
            statusCode: 200,
            body: JSON.stringify(raNames),
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: `An error occurred while fetching RAs: ${error.message}` }),
        };
    }
};
