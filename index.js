
import express, { urlencoded } from 'express'
import cors from 'cors'
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from "cookie-parser";

const app = express();
const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
};

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true
}));

app.use(cookieParser());

app.use(express.json())
app.use(urlencoded({ extended: true }))

const url = process.env.MONGODB_URI || 'mongodb://zainnaveed359_db_user:zzaaiinn1.2.3@ac-0ofxrjd-shard-00-00.ii7y96v.mongodb.net:27017,ac-0ofxrjd-shard-00-01.ii7y96v.mongodb.net:27017,ac-0ofxrjd-shard-00-02.ii7y96v.mongodb.net:27017/?ssl=true&replicaSet=atlas-128yqp-shard-0&authSource=admin&appName=Cluster0'

const schema = new mongoose.Schema({
    userId: { type: Number, unique: true, required: true },
    name: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    contacts: [
        {
            contactId: Number,   // real userId
            contactName: String  // custom name (user gives)
        }
    ]
})

const Users = mongoose.model('users', schema);

async function connectToDatabase() {
    try {
        await mongoose.connect(url, {
            dbName: 'express-message-sending',
        });
        console.log('Connected to MongoDB successfully');
    } catch (err) {
        console.error('Error connecting to MongoDB:', err);
    }
}

connectToDatabase();

async function generateUserId() {
    let userId;
    let exists = true;

    while (exists) {
        // generate 7-digit number (1000000 → 9999999)
        userId = Math.floor(1000000 + Math.random() * 9000000);

        const user = await Users.findOne({ userId });
        if (!user) {
            exists = false; // unique mil gaya ✅
        }
    }

    return userId;
}

const verifyToken = (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ message: "No token provided", token: false });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "chatConnect");
        req.user = decoded; // Store decoded info in request for later use
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid token", token: false });
    }
}

// ✅ Get users
app.get('/users', verifyToken, async (req, res) => {
    try {
        const data = await Users.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/check-auth", verifyToken, async (req, res) => {
    try {
        if (!req.user || !req.user.email) {
            return res.status(401).json({
                loggedIn: false,
                message: "Invalid token data"
            });
        }

        const dbUserData = await Users.findOne({ email: req.user.email });

        if (!dbUserData) {
            return res.status(404).json({
                loggedIn: false,
                message: "User not found"
            });
        }

        return res.json({
            loggedIn: true,
            user: {
                name: dbUserData.name,
                email: dbUserData.email,
                userId: dbUserData.userId
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// ✅ Register user
app.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "All fields are required",
                success: false
            });
        }

        const existingEmail = await Users.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({
                message: "Email you use is already registered use Different Email",
                success: false,
                emailTaken: true
            });
        }

        const existingName = await Users.findOne({ name });
        if (existingName) {
            return res.status(400).json({
                message: "Username already exists, please choose a different username",
                success: false,
                usernameTaken: true
            })
        }

        const jwtToken = await new Promise((resolve, reject) => {
            jwt.sign({ email }, process.env.JWT_SECRET || "chatConnect", { expiresIn: '7d' }, (err, token) => {
                if (err) return reject(err);
                resolve(token);
            });
        });

        res.cookie("token", jwtToken, cookieOptions);

        const userId = await generateUserId();

        const hashPassword = await bcrypt.hash(password, 10);
        const user = new Users({ userId, name, email, password: hashPassword, contacts: {} });
        await user.save();
        res.status(201).json({
            message: "User registered successfully",
            success: true,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
})

// ✅ Login user

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "pleasee fill all the fields",
                success: false
            })
        }

        const dbUserData = await Users.findOne({ email: email });

        // const updatedUser = await Users.findOneAndUpdate(
        //     { email }, // find user
        //     {
        //         $push: { receiveMSG: "hello this patch request test" } // add message to array
        //     },
        //     { new: true } // return updated document
        // );

        // res.json({
        //     message: "Message added successfully",
        //     user: updatedUser
        // });

        if (!dbUserData) {
            return res.status(401).json({
                message: "Invalid email or password",
                success: false,
                invalidemail: true
            })
        }

        const isPasswordValid = await bcrypt.compare(password, dbUserData.password);

        // Old code (problem): callback sets jwtToken asynchronously, response can be sent before this runs
        // jwt.sign({email}, "secretkey", {expiresIn: '7d'} , (err, token) => {
        //     if (err) {
        //         res.status(500).json({ message:"Fail to generate token", success: false })
        //     }
        //     jwtToken = token;
        // })
        // let jwtToken;

        // Fixed: use Promise wrapper + await so token is available before response
        if (!isPasswordValid) {
            return res.status(401).json({
                message: "Invalid email or password",
                success: false,
                invalidpassword: true
            })
        }

        const jwtToken = await new Promise((resolve, reject) => {
            jwt.sign({ email: dbUserData.email }, process.env.JWT_SECRET || "chatConnect", { expiresIn: '7d' }, (err, token) => {
                if (err) {
                    return reject(err);
                }
                resolve(token);
            });
        });

        res.cookie("token", jwtToken, cookieOptions);

        return res.status(200).json({
            message: "Login successful",
            success: true,
            user: {
                name: dbUserData.name,
                email: dbUserData.email,
                userId: dbUserData.userId,
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
})

app.post("/add-contact", async (req, res) => {
    try {
        const { userId, contactId, contactName } = req.body;

        const parsedUserId = Number(userId);
        const parsedContactId = Number(contactId);

        if (!userId || !contactId || !contactName) {
            return res.status(400).json({
                message: "All fields are required",
                success: false
            })
        }

        if (
            Number.isNaN(parsedUserId) ||
            Number.isNaN(parsedContactId) ||
            !Number.isInteger(parsedUserId) ||
            !Number.isInteger(parsedContactId)
        ) {
            return res.status(400).json({
                message: "userId and contactId must be integer numbers",
                success: false
            });
        }

        const contactUserExist = await Users.findOne({ userId: parsedContactId });

        console.log("Contact user exist:", contactUserExist);

        const userExist = await Users.findOne({ userId: parsedUserId });

        if (!userExist) {
            return res.status(404).json({
                message: "User not found",
                success: false,
                nouser: true
            })
        }


        if (!contactUserExist) {
            return res.status(404).json({
                message: "Contact user not found",
                success: false,
                nouser: true
            })
        }

        const updateUserContacts = await Users.findOneAndUpdate(
            { userId: Number(userId) },
            {
                $push: {
                    contacts: {
                        contactId,
                        contactName,
                    }
                }
            }
        );

        res.status(200).json({
            message: "Contact added successfully",
            success: true,
            data: updateUserContacts
        });
    } catch (err) {
        res.status(500).json({ error: err.message, success: false
         });
         console.log(err)
    }
})

app.get("/contacts/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const parsedUserId = Number(userId);

        if (Number.isNaN(parsedUserId) || !Number.isInteger(parsedUserId)) {
            return res.status(400).json({
                message: "Invalid userId, integer required",
                success: false
            });
        }

        const user = await Users.findOne({ userId: parsedUserId });

        if (!user) {
            return res.status(404).json({
                message: "User not found",
                success: false
            })
        }

        res.status(200).json({
            message: "Contacts retrieved successfully",
            success: true,
            data: user.contacts
        });
    } catch (err) {
        res.status(500).json({ error: err.message, success: false });
    }
});

const messageSchema = new mongoose.Schema({
    senderId: { type: Number, required: true },
    receiverId: { type: Number, required: true },
    message: { type: String, required: true },
    time: { type: String, required: true }
})

const Messages = mongoose.model('Messages', messageSchema);

app.post("/send-message", async (req, res) => {
    try {
        const options = {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            timeZone: "Asia/Karachi", // Replace with your desired time zone (IANA name)
        };

        const currentTime = new Intl.DateTimeFormat("en-US", options).format(new Date());
        const { senderId, receiverId, message } = req.body;

        if (!senderId || !receiverId || !message) {
            return res.status(400).json({
                message: "All fields are required",
                success: false
            })
        }

        const isReceiverExist = await Users.findOne({ userId: receiverId });

        if (!isReceiverExist) {
            return res.status(404).json({
                message: "Receiver not found",
                success: false
            })
        }

        const newMessage = await Messages.create({ senderId, receiverId, message, time: currentTime });
        res.status(201).json({
            message: "Message sent successfully",
            success: true,
            data: newMessage
        })
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})

app.get('/chat', async (req, res) => {
    try {
        const { user1, user2 } = req.query;

        const user1Data = await Users.findOne({ userId: user1 });
        const user2Data = await Users.findOne({ userId: user2 });

        if (!user1Data || !user2Data) {
            return res.status(404).json({
                message: "User not found",
                success: false
            })
        }

        const messages = await Messages.find({
            $or: [
                { senderId: user1, receiverId: user2 },
                { senderId: user2, receiverId: user1 }
            ]
        }).sort({ timestamp: 1 });

        res.json(messages);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`)
});
