import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

export const CHAT_ID_ERROR = '-1002354704686';

export const sendMessage = async (botToken: string, chat_id: string, botName: string | undefined, message: string): Promise<boolean> => {
    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        let message_formatted = message;
        if (botName) {
            message_formatted = `Bot ${botName}\n${message}\n@pi3rrem @Lao0ni`;
        }

        const payload = {
            chat_id,
            text: message_formatted,
            parse_mode: "html",
            link_preview_options: { is_disabled: true }
        };
        const headers = { 'Content-Type': 'application/json' };

        try {
            console.log(url, payload)
            const response = await axios.post(url, payload, { headers });
            console.log('Message sent:', response.data);
            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('Failed to send the message:', error.response?.data || error.message);
            } else {
                console.error('An error occurred while sending the message:', error);
            }
            return false;
        }
    }
    catch (e) {
        console.error(e);
        return false;
    }
}