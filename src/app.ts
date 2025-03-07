import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import express from 'express';
import { Request, Response } from 'express';
import { questions } from "./games/family100";
import chromium from 'chrome-aws-lambda';

// Express app untuk health check
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req: Request, res: Response) => {
  res.send('Bot is running!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

const initializeClient = async () => {
  const client = new Client({
    puppeteer: {
      args: chromium.args,
      executablePath: await chromium.executablePath,
      headless: true,
      defaultViewport: null,
      ignoreHTTPSErrors: true,
    },
    authStrategy: new LocalAuth(),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2332.15.html'
    }
  });

  client.on("qr", (qr: string) => {
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("Client is ready!");
  });

  client.on('disconnected', (reason) => {
    console.log('Client was disconnected', reason);
    client.destroy();
    setTimeout(() => {
      initializeClient();
    }, 5000);
  });

  interface Family100Session {
    question: { question: string; answers: { text: string; points: number }[] };
    answersFound: { [key: string]: { usernames: string[]; points: number } };
    score: number;
  }

  const family100Sessions: Record<string, Family100Session> = {};

  client.on("message", async (msg: Message) => {
    const userId = msg.author || msg.from;
    const contact = await msg.getContact();
    const username = contact.pushname || contact.name || "User";

    const command = msg.body
      .toLowerCase()
      .trim()
      .replace(/^\.\s*/, ".");

    // Start the Family 100 game
    if (command === ".f100") {
      if (family100Sessions[msg.from]) {
        return msg.reply("Game Family 100 sedang berlangsung!");
      }

      const selectedQuestion =
        questions[Math.floor(Math.random() * questions.length)];

      const blanks = selectedQuestion.answers
        .map((_, index) => `${index + 1}. _______`)
        .join("\n");

      family100Sessions[msg.from] = {
        question: selectedQuestion,
        answersFound: {},
        score: 0,
      };

      msg.reply(
        `Family 100 dimulai!\n\nPertanyaan:\n${selectedQuestion.question}\n\n${blanks}\n\nKetik jawaban kalian langsung!\nKetik .nyerah untuk menyerah.`
      );

      return;
    }

    // Handle player resignation
    if (command === ".nyerah" && family100Sessions[msg.from]) {
      const session = family100Sessions[msg.from];
      const answersList = session.question.answers
        .map((ans, index) => {
          const foundAnswer = session.answersFound[ans.text];
          const answerDetails = foundAnswer
            ? `${ans.text} (${foundAnswer.points}) - ${foundAnswer.usernames.join(
                ", "
              )}`
            : "_______";
          return `${index + 1}. ${answerDetails}`;
        })
        .join("\n");

      delete family100Sessions[msg.from];

      if (session.score > 0) {
        msg.reply(
          `Anda Menyerah, game telah diberhentikan!\n\nPertanyaan: ${session.question.question}\nJawaban yang sudah terjawab:\n${answersList}`
        );
      } else {
        msg.reply(
          `Anda Menyerah, game telah diberhentikan!\n\nPertanyaan: ${session.question.question}\nTidak ada jawaban yang terjawab.`
        );
      }

      return;
    }

    // Process the answer after the question has been asked
    if (family100Sessions[msg.from]) {
      const session = family100Sessions[msg.from];
      const userAnswer = msg.body.trim().toLowerCase();

      if (userAnswer && userAnswer !== ".nyerah") {
        try {
          const correctAnswers = session.question.answers.map((a) => a.text);

          const apiUrl = process.env.API_URL || 'https://api.ryzendesu.vip/api/ai/chatgpt';
          const response = await axios.get(apiUrl, {
            headers: {
              accept: "application/json",
            },
            params: {
              text: `Kamu adalah asisten dalam permainan Family 100\n\n- Pertanyaan: "${
                session.question.question
              }"\n- Daftar jawaban yang benar: ${correctAnswers.join(
                ", "
              )}\n- Jawaban pemain: "${userAnswer}"\n\nJika jawaban pemain ada di daftar jawaban yang benar / memiliki makna yang sama, benarkan jawaban pemain dan berikan output:\n"BENAR: jawaban" jawaban harus ada dan persis di daftar jawaban.\n\ncontoh:\n- Jawaban pemain: "mi gorng"\n- berikan output: "BENAR: mie goreng"\n\njika jawabannya tidak ada/tidak nyambung, balas dan tanggapi non formal tanpa mengulangi teks ini(jangan ada teks "jawaban pemain","tanggapan" cukup jawab biasa). jawaban harus ada di daftar jawaban yang benar. jangan spoiler`
            }
          });

          const aiResponse = response.data.result;

          if (aiResponse.startsWith("BENAR:")) {
            const correctAnswer = aiResponse.split(":")[1].trim();

            // Check if the answer has already been found
            const foundAnswer = session.answersFound[correctAnswer];
            if (foundAnswer) {
              return msg.reply(`❌ Jawaban sudah terjawab (${correctAnswer})!`);
            }

            const correctAnswerObj = session.question.answers.find((a) =>
              a.text.toLowerCase().includes(correctAnswer.toLowerCase())
            );

            if (correctAnswerObj) {
              session.answersFound[correctAnswerObj.text] = {
                usernames: [username],
                points: correctAnswerObj.points,
              };
              session.score += correctAnswerObj.points;

              let answersList = session.question.answers
                .map((ans, index) => {
                  const foundAnswer = session.answersFound[ans.text];
                  const answerDetails = foundAnswer
                    ? `${ans.text} (${
                        foundAnswer.points
                      }) - ${foundAnswer.usernames.join(", ")}`
                    : "_______";
                  return `${index + 1}. ${answerDetails}`;
                })
                .join("\n");

              msg.reply(
                `✅ Jawaban benar!\n\n${session.question.question}\n\n${answersList}\n\nKetik jawaban kalian lagi atau ketik .nyerah untuk menyerah.`
              );

              if (
                Object.keys(session.answersFound).length ===
                session.question.answers.length
              ) {
                delete family100Sessions[msg.from];
                msg.reply(
                  `🎉 Selamat! Semua jawaban benar! Total Skor: ${session.score}\nJawaban lengkap:\n${answersList}`
                );
              }
            }
          } else {
            msg.reply(aiResponse);
          }
        } catch (error) {
          console.error("Error processing AI response:", error);
          msg.reply("Ada masalah saat memeriksa jawaban. Coba lagi nanti.");
        }
      }
    }
  });

  process.on('unhandledRejection', (reason: any, p: Promise<any>) => {
    console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    client.destroy();
    setTimeout(() => {
      initializeClient();
    }, 5000);
  });

  await client.initialize();
};

initializeClient();