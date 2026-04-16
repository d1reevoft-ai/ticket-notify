const Database = require('better-sqlite3');
const FunAI = require('./src/bot/funai');

const db = new Database(':memory:');
try {
    const memory = new FunAI({userId: 1, addLog: console.log}, db);
    console.log("Success!");
} catch(e) {
    console.error("Crash FunAI:", e);
}
