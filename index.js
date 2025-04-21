require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const nodemailer = require("nodemailer");
const port = process.env.PORT || 5000;

// Middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'https://first-dp-house.web.app', 'https://first-dp-house.firebaseapp.com'],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// /send email using nodemailer
const sendEmail = (emailAddress, emailData) => {
  // create transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, 
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  });
  // verify connection
  transporter.verify((error, success) => {
    if (error) {
      console.log(error)
    } else {
      // console.log('Transporter is ready to emails', success)
    }
  })
  //  transporter.sendMail()
  const mailBody = {
    from: process.env.NODEMAILER_USER, 
    to: emailAddress, 
    
    html: `<p>${emailData?.message}</p>`, 
  }
  // send email
  transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error)
    } else {
      // console.log(info)
      console('Email Sent: ' + info?.response)
    }

  })
}


// MongoDB URI setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ce1uiqf.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.error('JWT error:', err);
      return res.status(401).send({ message: 'unauthorized access' });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    // await client.connect();

    // ✅ Generate JWT Token
    app.post('/jwt', async (req, res) => {
      const user = req.body; // expecting { email: "abc@email.com" }

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '7d',
      });

      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true });
    });

    // ✅ Clear Cookie (Logout)
    app.get('/logout', (req, res) => {
      res
        .clearCookie('token', {
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true });
    });

    const userCollection = client.db('LBBD').collection('users');
    const numberCollection = client.db('LBBD').collection('numbers');
    const depositCollection = client.db('LBBD').collection('deposits');
    const addWithdrawCollection = client.db('LBBD').collection('addWithdraws');
    const withdrawCollection = client.db('LBBD').collection('withdraws');



    // / verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;
      const query = { email }
      const result = await userCollection.findOne(query)
      if (!result || result?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Forbidden Access ! Admin only Action' })
      next()

    }


    // / User<------------------------------------------>
    // save or update user in db 
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;

      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }

      // বাংলাদেশ সময় অনুযায়ী টাইমস্ট্যাম্প (string format)
      const bdTime = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Dhaka",
      });

      const result = await userCollection.insertOne({
        ...user,
        role: 'customer',
        timestamp: bdTime, // বাংলাদেশ টাইম
      });

      res.send(result);
    });


    /// get all users except admins, latest first
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const query = { role: { $ne: "admin" } }; // exclude admins
      const result = await userCollection.find(query).sort({ _id: -1 }).toArray();
      res.send(result);
    });

    // delete user by ID
    app.delete('/users/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      try {
        const result = await userCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error('User delete error:', error);
        res.status(500).send({ error: 'Failed to delete user' });
      }
    });
    // / get user role
    app.get('/users/role/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      const result = await userCollection.findOne({ email })
      res.send({ role: result?.role })
    })






    // Numbers --------------------------------------->

    // get inventory data for  admin
    app.get('/numbers/seller', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.user.email
      const result = await numberCollection.find({ 'admin.email': email }).toArray()
      res.send(result)
    })
    app.patch('/numbers/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const result = await numberCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.send(result);
    });

    app.post('/numbers', verifyToken, verifyAdmin, async (req, res) => {
      const numbers = req.body;
      const result = await numberCollection.insertOne(numbers)
      res.send(result)
    })

    // get all numbers data in db
    app.get('/numbers', async (req, res) => {
      const result = await numberCollection.find().toArray()
      res.send(result)
    })
    // get a number by id
    app.get('/numbers/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await numberCollection.findOne(query)
      res.send(result)
    })
    // delete number
    app.delete('/numbers/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const result = await numberCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount > 0) {
          res.send({ deletedCount: 1 });
        } else {
          res.send({ deletedCount: 0 });
        }
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });




    // Deposits save in db --------------------------------------------->
    app.post('/deposits', verifyToken, async (req, res) => {
      try {
        const depositData = req.body;

        // 🇧🇩 বাংলাদেশ সময় সেট
        const nowUTC = new Date();
        const bdTime = nowUTC; 

        // বাংলাদেশ সময় AM/PM ফরম্যাটে কনভার্ট করা
        const options = {
          timeZone: "Asia/Dhaka",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          hour12: true,
        };

        const bdTimeFormatted = bdTime.toLocaleString("bn-BD", options);

   
        const deposits = {
          ...depositData,
          createdAt: bdTime.toISOString(), 
          formattedTime: bdTimeFormatted 
        };

        // MongoDB তে ডাটা ইন্সার্ট
        const result = await depositCollection.insertOne(deposits);

        // যদি সফলভাবে ডিপোজিট যুক্ত হয়
        if (result?.insertedId) {
          // ডিপোজিট থেকে প্রয়োজনীয় তথ্য বের করা
          const { customer, amount, trxId, status, createdAt, numberName } = deposits;

          // ✅ কাস্টমারের ইমেইল পাঠানো
          await sendEmail(customer.email, {
            subject: "✅ আপনার ডিপোজিট রিকোয়েস্ট সফলভাবে গ্রহণ করা হয়েছে!",
            message: `
                    <h3>প্রিয় ${customer.name},</h3>
                    <p>আপনার <strong>${amount} ৳</strong> ডিপোজিট রিকোয়েস্ট আমরা পেয়েছি।</p>
                    <p><strong>Transaction ID:</strong> ${trxId}</p>
                    <p><strong>Status:</strong> ${status}</p>
                    <p><strong>অনুরোধের তারিখ:</strong> ${new Date(createdAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}</p>
                    <br>
                    <p>আপনার সহযোগিতার জন্য ধন্যবাদ।</p>
                    <p><strong>𝐃𝐞𝐩𝐨𝐬𝐢𝐭 & 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰 𝐒𝐞𝐫𝐯𝐢𝐜𝐞</strong></p>
                `
          });

          // ✅ অ্যাডমিনের ইমেইল পাঠানো
          await sendEmail(depositData.admin, {
            subject: "📢 নতুন ডিপোজিট রিকোয়েস্ট এসেছে!",
            message: `
                    <h3>প্রিয় এডমিন,</h3>
                    <p>নতুন একজন কাস্টোমার ডিপোজিট রিকোয়েস্ট করেছেন।</p>
                    <p><strong>নাম:</strong> ${customer.name}</p>
                    <p><strong>ইমেইল:</strong> ${customer.email}</p>
                    <p><strong>Amount:</strong> ${amount} ৳</p>
                    <p><strong>TrxId:</strong> ${trxId}</p>
                    <p><strong>ডিপোজিট করেছে:</strong> ${numberName} দিয়ে ।</p>
                    <p><strong>Status:</strong> ${status}</p>
                    <p><strong>রিকোয়েস্ট টাইম:</strong> ${bdTimeFormatted}</p>
                `
          });
        }

        // response পাঠানো
        res.send(result);

      } catch (error) {
        console.error("Deposit Insert Error:", error);
        res.status(500).send({ message: "Deposit Failed", error });
      }
    });



    // get customer deposits data in db
    app.get('/customer-deposits/:email', async (req, res) => {
      const email = req.params.email;
      const query = { 'customer.email': email };
      const result = await depositCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    // get admin all deposit data in db
    app.get('/admin-deposits', verifyToken, verifyAdmin, async (req, res) => {
      const result = await depositCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(result);
    });
    // update status
    app.patch('/update-deposits-status/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        // 🔹 Validate input
        if (!status) {
          return res.status(400).send({ message: "Status is required" });
        }

        // 🔹 Find the booking
        const bookingInfo = await depositCollection.findOne({ _id: new ObjectId(id) });

        if (!bookingInfo) {
          return res.status(404).send({ message: "Booking not found" });
        }

        // 🔹 Prevent redundant updates
        if (bookingInfo.status === status) {
          return res.status(400).send({ message: "Booking status is already updated" });
        }

        // 🔹 Update the status
        const result = await depositCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        // 🔹 Return success response
        if (result.modifiedCount > 0) {
          return res.send({ message: "Status updated successfully" });
        } else {
          return res.status(500).send({ message: "Failed to update status" });
        }
      } catch (error) {
        console.error("Error updating deposit status:", error);
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // Deleted Deposit
    app.delete('/delete-deposit/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const deposits = await depositCollection.findOne(query)
      if (deposits.status === 'Confirm') {
        res.status(409).send('Cannot cancel once the Slot is Confirm')
      }
      const result = await depositCollection.deleteOne(query)
      res.send(result)
    })

    // withdraws save in db --------------------------------------------->
    app.post('/withdraws', verifyToken, async (req, res) => {
      try {
        const withdrawData = req.body;
    
        // 🇧🇩 বাংলাদেশ সময় সেট
        const nowUTC = new Date();
        const bdTime = nowUTC; 
        const options = {
          timeZone: "Asia/Dhaka",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          hour12: true,  
        };
        const bdTimeFormatted = bdTime.toLocaleString("bn-BD", options);
    

        const withdraws = {
          ...withdrawData,
          createdAt: bdTime.toISOString(), 
          formattedTime: bdTimeFormatted 
        };
    
      
        const result = await withdrawCollection.insertOne(withdraws);
    
      
        if (result?.insertedId) {
          const { customer, amount, withdrawCode, status, createdAt, numberName, walletNumber } = withdraws;
    
          // ✅ কাস্টমারের ইমেইল পাঠানো
          await sendEmail(customer.email, {
            subject: "✅ আপনার উইথড্র রিকোয়েস্ট সফলভাবে গ্রহণ করা হয়েছে!",
            message: `
              <h3>প্রিয় ${customer.name},</h3>
              <p>আপনার <strong>${amount} ৳</strong> উইথড্র রিকোয়েস্ট আমরা পেয়েছি।</p>
              <p><strong>Withdraw Code:</strong> ${withdrawCode}</p>
              <p><strong>Status:</strong> ${status}</p>
              <p><strong>অনুরোধের তারিখ:</strong> ${new Date(createdAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}</p>
              <br>
              <p>আপনার সহযোগিতার জন্য ধন্যবাদ।</p>
              <p><strong>𝐃𝐞𝐩𝐨𝐬𝐢𝐭 & 𝐰𝐢𝐭𝐡𝐝𝐫𝐚𝐰 𝐒𝐞𝐫𝐯𝐢𝐜𝐞</strong></p>
            `
          });
    
          // ✅ অ্যাডমিনকে ইমেইল পাঠানো
          await sendEmail(withdrawData.admin, {
            subject: "📢 নতুন উইথড্র রিকোয়েস্ট এসেছে!",
            message: `
              <h3>প্রিয় এডমিন,</h3>
              <p>নতুন একজন কাস্টোমার উইথড্র রিকোয়েস্ট করেছেন।</p>
              <p><strong>নাম:</strong> ${customer.name}</p>
              <p><strong>ইমেইল:</strong> ${customer.email}</p>
              <p><strong>Amount:</strong> ${amount} ৳</p>
              <p><strong>Withdraw Code:</strong> ${withdrawCode}</p>
              <p><strong>উইথড্র  রিকোয়েস্ট</strong> ${numberName}  নাম্বারে করেছে ।</p>
              <p><strong>Status:</strong> ${status}</p>
              <p><strong>রিকোয়েস্ট টাইম:</strong> ${new Date(createdAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}</p>
            `
          });
        }
    
        // response পাঠানো
        res.send(result);
    
      } catch (error) {
        console.error("Withdraw Insert Error:", error);
        res.status(500).send({ message: "Withdraw Failed", error });
      }
    });
    

    // get customer deposits data in db
    app.get('/customer-withdraws/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'customer.email': email };
      const result = await withdrawCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    // get admin all deposit data in db
    app.get('/admin-withdraw', verifyToken, verifyAdmin, async (req, res) => {
      const result = await withdrawCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(result);
    });


    // update status
    app.patch('/update-withdraw-status/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        // 🔹 Validate input
        if (!status) {
          return res.status(400).send({ message: "Status is required" });
        }

        // 🔹 Check if withdraw request exists
        const withdrawInfo = await withdrawCollection.findOne({ _id: new ObjectId(id) });

        if (!withdrawInfo) {
          return res.status(404).send({ message: "Withdraw request not found" });
        }

        // 🔹 Prevent redundant updates
        if (withdrawInfo.status === status) {
          return res.status(400).send({ message: "Withdraw status is already updated" });
        }

        // 🔹 Update the status
        const result = await withdrawCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        // 🔹 Return response
        if (result.modifiedCount > 0) {
          return res.send({ message: "Status updated successfully" });
        } else {
          return res.status(500).send({ message: "Failed to update status" });
        }
      } catch (error) {
        console.error("Error updating withdraw status:", error);
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.delete('/delete-withdraw/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const withdraw = await withdrawCollection.findOne(query)
      if (withdraw.status === 'Confirm') {
        res.status(409).send('Cannot cancel once the Slot is Confirm')
      }
      const result = await withdrawCollection.deleteOne(query)
      res.send(result)
    })

    // all data get deposits and withdraw
    app.get('/transactions', async (req, res) => {
      try {
        const deposits = await depositCollection.find({}).toArray();
        const withdraws = await withdrawCollection.find({}).toArray();
    
        // সব ডেটার মধ্যে formattedTime না থাকলে সেট করো
        const allData = [...deposits, ...withdraws].map(tx => {
          const bdDate = new Date(tx.createdAt);
          const formattedTime = bdDate.toLocaleString("bn-BD", {
            timeZone: "Asia/Dhaka",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            hour12: true,
          });
    
          return {
            ...tx,
            formattedTime // নতুনভাবে formattedTime সেট করা হলো
          };
        });
    
        // বাংলাদেশ সময় অনুসারে নতুন করে sort করা
        const transactions = allData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
        res.send({ transactions });
      } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).send({ message: 'Failed to fetch transactions' });
      }
    });
    










    // addWithdraw--------------------------------------->
    app.get('/addWithdraws/seller', verifyToken, async (req, res) => {
      const email = req.user.email
      const result = await addWithdrawCollection.find({ 'admin.email': email }).toArray()
      res.send(result)
    })
    // delete number
    app.delete('/addWithdraws/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const result = await addWithdrawCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount > 0) {
          res.send({ deletedCount: 1 });
        } else {
          res.send({ deletedCount: 0 });
        }
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });




    app.post('/addWithdraws', verifyToken, async (req, res) => {
      const addWithdraw = req.body;
      const result = await addWithdrawCollection.insertOne(addWithdraw)
      res.send(result)
    })
    // get all addWithdraw data in db
    app.get('/addWithdraws', async (req, res) => {
      const result = await addWithdrawCollection.find().toArray()
      res.send(result)
    })

    // get a addWithdraws by id
    app.get('/addWithdraws/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await addWithdrawCollection.findOne(query);
      res.send(result);
    });




    // Ping DB
    // await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB!");

  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
  }
  // ⚠️ Do NOT close client here if you want to use DB later
  // await client.close(); ← এইটা বাদ দাও
}

run().catch(console.dir);

// Test Route
app.get('/', (req, res) => {
  res.send('🎯 LBBD Server is Running!');
});

// Start Server
app.listen(port, () => {
  console.log(`🚀 LBBD Server is running on port ${port}`);
});
