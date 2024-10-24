import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

export const sendTgErrorMessage = async (botName: string, message: string): Promise<boolean> => {
    try {
        const url = `https://api.telegram.org/bot${process.env.TG_API_KEY_BOT_ERROR}/sendMessage`;

        const message_formatted = `Bot ${botName}\n${message}\n@pi3rrem @Lao0ni`;

        const payload = {
            chat_id: '-1002354704686',
            text: message_formatted,
            parse_mode: "html",
            link_preview_options: { is_disabled: true }
        };
        const headers = { 'Content-Type': 'application/json' };

        try {
            const response = await axios.post(url, payload, { headers });
            console.log('Message sent:', response.data);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('Failed to send the message:', error.response?.data || error.message);
            } else {
                console.error('An error occurred while sending the message:', error);
            }
        }
        return true;
    }
    catch (e) {
        console.error(e);
        return false;
    }
}

export const sendTgMessage = async (botApiKey: string, chat_id: string, message: string): Promise<boolean> => {
    try {
        const url = `https://api.telegram.org/bot${botApiKey}/sendMessage`;

        try {
            const response = await axios.post(url, null, {
                params: {
                    chat_id,
                    text: message,
                    parse_mode: 'html',
                    disable_web_page_preview: 'true',
                },
            });
            console.log('Message sent:', response.data);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('Failed to send the message:', error.response?.data || error.message);
            } else {
                console.error('An error occurred while sending the message:', error);
            }
        }
        return true;
    }
    catch (e) {
        console.error(e);
        return false;
    }
}