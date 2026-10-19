require("dotenv").config();

const { connectRedis, redisClient } = require("./src/config/redis");

async function testRedis() {
    try {
        await connectRedis();

        const result = await redisClient.ping();
        console.log("Redis ping response:", result);
    } catch (error) {
        console.error("Redis test failed:", error.message);
    } finally {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    }
}

testRedis();