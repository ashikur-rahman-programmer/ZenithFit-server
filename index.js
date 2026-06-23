const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const PORT = process.env.PORT || 5000;
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const app = express();
const { ObjectId } = require("mongodb");

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

// verify token
// const JWKS = createRemoteJWKSet(
//   new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
// );

// const verifyToken = async (req, res, next) => {
//   const authHeader = req?.headers.authorization;
//   // console.log(authHeader);

//   if (!authHeader) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }

//   const token = authHeader.split(" ")[1];

//   // console.log(token);

//   if (!token) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }

//   try {
//     const { payload } = await jwtVerify(token, JWKS);
//     req.user = payload;
//     next();
//   } catch (error) {
//     return res.status(401).json({ message: "Unauthorized" });
//   }
// };

//mongodb connect
const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //database and collection
    const db = client.db("zenithFit");
    const userCollection = db.collection("user");
    const classesCollection = db.collection("classes");
    const bookingCollection = db.collection("booking");
    const favoritesCollection = db.collection("favorites");
    const trainerCollection = db.collection("trainerApplication");
    const forumCollection = db.collection("forum");

    // --- মিডলওয়্যার: ব্লক চেক ---
    const checkBlocked = async (req, res, next) => {
      const email = req.body?.email || req.query?.email || req.params?.email;

      // ইমেইল না থাকলে মিডেলওয়্যার থেকে বের হয়ে যান
      if (!email) return next();

      try {
        const user = await userCollection.findOne({ email: email });

        // ইউজার যদি ডাটাবেসে না থাকে, তবে ব্লকড কি না তা চেক করার দরকার নেই
        if (!user) return next();

        const isStatusUpdate =
          req.method === "PATCH" && req.body?.status !== undefined;

        if (user.status === "Blocked" && !isStatusUpdate) {
          return res
            .status(403)
            .json({ message: "Action restricted by Admin" });
        }
        next();
      } catch (error) {
        console.error("CheckBlocked Error:", error);
        next();
      }
    };

    // admin overview
    app.get("/api/admin-stats", async (req, res) => {
      const usersCount = await userCollection.countDocuments();
      const classesCount = await classesCollection.countDocuments();
      const bookingsCount = await bookingCollection.countDocuments();

      res.send({ usersCount, classesCount, bookingsCount });
    });

    // admin transaction api
    app.get("/api/transaction", async (req, res) => {
      const query = await bookingCollection.find().toArray();
      res.send(query);
    });

    // --- USER API ---
    app.get("/api/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.patch("/api/users/:email", checkBlocked, async (req, res) => {
      try {
        const email = req.params.email;
        const { role, status } = req.body;

        const userToUpdate = await userCollection.findOne({ email });
        if (!userToUpdate) {
          return res.status(404).json({ message: "User not found" });
        }

        if (status === "Blocked" && userToUpdate.role === "admin") {
          return res
            .status(403)
            .json({ message: "Action restricted: Admins cannot be blocked." });
        }

        const updateDoc = {
          $set: {
            ...(role && { role }),
            ...(status && { status }),
          },
        };

        const result = await userCollection.updateOne({ email }, updateDoc);

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User updated successfully" });
        } else {
          res
            .status(400)
            .send({ message: "No changes made or user not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // --- FORUM API ---
    app.get("/api/forum", async (req, res) => {
      const result = await forumCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/forum", checkBlocked, async (req, res) => {
      try {
        const postData = req.body;
        const result = await forumCollection.insertOne({
          ...postData,
          createdAt: new Date(),
        });
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to publish post" });
      }
    });

    app.delete("/api/forum/:id", checkBlocked, async (req, res) => {
      const id = req.params.id;
      const result = await forumCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // --- TRAINER & STATS API ---
    app.get("/api/user-stats/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const booked = await bookingCollection.countDocuments({ email });
        const favorites = await favoritesCollection.countDocuments({ email });
        const trainerApp = await trainerCollection.findOne({ email });
        res.json({ booked, favorites, trainerApp });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    });

    app.post("/api/trainer-application", checkBlocked, async (req, res) => {
      try {
        const { email } = req.body;
        const existing = await trainerCollection.findOne({ email });
        if (existing && existing.status === "Pending") {
          return res
            .status(400)
            .json({ error: "Already applied. Please wait." });
        }
        if (existing && existing.status === "Rejected") {
          await trainerCollection.deleteOne({ email });
        }
        const application = {
          ...req.body,
          status: "Pending",
          appliedAt: new Date(),
        };
        const result = await trainerCollection.insertOne(application);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ error: "Server error" });
      }
    });

    app.get("/trainer-application", async (req, res) => {
      try {
        const applications = await trainerCollection
          .find({ status: "Pending" })
          .toArray();
        res.send(applications);
      } catch (error) {
        res.status(500).send({ message: "Error fetching data" });
      }
    });

    app.patch("/trainer-application/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status, feedback, email } = req.body;

        // ১. স্ট্যাটাস আপডেট করুন
        const result = await trainerCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status, feedback: feedback } }, // status এখানে আপডেট হবে
        );

        // ২. যদি এপ্রুভ হয়, তবেই রোল আপডেট করুন
        if (status === "Approved") {
          await userCollection.updateOne(
            { email: email },
            { $set: { role: "trainer" } },
          );
        }

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ success: false, message: "Update Failed" });
      }
    });

    // BOOKING DATA
    app.get("/api/my-bookings/:email", async (req, res) => {
      try {
        const email = req.params.email;
        // bookingCollection থেকে ওই ইমেইলের সব বুকিং খুঁজে বের করা
        const myBookings = await bookingCollection
          .find({ email: email })
          .toArray();
        res.send(myBookings);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch bookings" });
      }
    });

    //favorite api
    app.get("/api/my-favorites/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const favorites = await favoritesCollection
          .find({ email: email })
          .toArray();
        res.send(favorites);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch favorites" });
      }
    });

    // --- FAVORITES & BOOKING ---
    app.post("/api/favorites/toggle", checkBlocked, async (req, res) => {
      try {
        const { email, classId, classData } = req.body;
        const query = { email, classId };
        const existing = await favoritesCollection.findOne(query);
        if (existing) {
          await favoritesCollection.deleteOne(query);
          return res.send({ status: "removed" });
        } else {
          await favoritesCollection.insertOne({
            email,
            classId,
            classData,
            addedAt: new Date(),
          });
          return res.send({ status: "added" });
        }
      } catch (error) {
        res.status(500).send({ error: "Failed to toggle" });
      }
    });

    // --- CLASSES API ---
    // Get all
    app.get("/api/classes", async (req, res) => {
      // ফ্রন্টএন্ড থেকে আসা ডাটাগুলো রিসিভ করা (limit 9 করা হয়েছে)
      const { search, category, page = 1, limit = 9 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // ডিফল্ট কোয়েরি (শুধু Approved ক্লাস)
      let query = { status: "Approved" };

      // ১. Search Logic (Empty string এবং Case-Insensitive ফিক্স)
      if (search && search.trim() !== "") {
        query.name = { $regex: search.trim(), $options: "i" };
      }

      // ২. Category Logic (Case-Insensitive ফিক্স)
      if (category && category !== "all" && category.trim() !== "") {
        // ডাটাবেসে "yoga", "Yoga", "YOGA" যাই থাকুক না কেন, এটি ম্যাচ করবে
        query.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
      }

      try {
        const total = await classesCollection.countDocuments(query);
        const classes = await classesCollection
          .find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        res.send({ classes, totalPages: Math.ceil(total / limit) });
      } catch (error) {
        console.error("Error fetching classes:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // সব ক্লাসের জন্য (Admin Only)
    app.get("/api/admin/classes", async (req, res) => {
      try {
        const classes = await classesCollection.find().toArray();
        res.send(classes);
      } catch (error) {
        res.status(500).send({ message: "Error fetching classes" });
      }
    });

    //get id api
    app.get("/api/classes/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // আইডি দিয়ে ডাটাবেস থেকে খোঁজা
        const query = { _id: new ObjectId(id) };
        const result = await classesCollection.findOne(query);

        // যদি ডাটা না পায়
        if (!result) {
          return res.status(404).send({ message: "Class not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error details:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/api/classes", checkBlocked, async (req, res) => {
      const result = await classesCollection.insertOne(req.body);
      res.send(result);
    });

    app.patch("/api/classes/status/:id", checkBlocked, async (req, res) => {
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } },
      );
      res.send(result);
    });

    app.delete("/api/classes/:id", checkBlocked, async (req, res) => {
      const result = await classesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    // --- TRAINER MY CLASSES ---
    app.get("/api/trainer/my-classes/:email", async (req, res) => {
      const myClasses = await classesCollection
        .find({ trainerEmail: req.params.email })
        .toArray();
      res.json({ classes: myClasses });
    });

    // admin trainer manage

    app.get("/api/trainers", async (req, res) => {
      try {
        // ফিল্টার ছাড়া সব ইউজার নিয়ে আসুন
        const allUsers = await userCollection.find().toArray();

        // ম্যানুয়ালি ফিল্টার করুন এবং লগ করুন
        const trainers = allUsers.filter((user) => {
          console.log(`Checking user: ${user.email}, Role: ${user.role}`);
          return user.role === "trainer";
        });

        console.log("Trainers filtered:", trainers);
        res.send(trainers);
      } catch (error) {
        res.status(500).send({ message: "Error" });
      }
    });

    // ট্রেইনার থেকে ইউজার করার জন্য (Demote)
    app.patch("/api/users/role/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const { role } = req.body;
        const result = await userCollection.updateOne(
          { email: email },
          { $set: { role: role } },
        );
        res.send({ success: result.modifiedCount > 0 });
      } catch (error) {
        res.status(500).send({ success: false });
      }
    });

    //trainer api
    app.get("/api/check-trainer-status/:email", async (req, res) => {
      const status = await trainerCollection.findOne({
        email: req.params.email,
      });
      res.json(status || {});
    });

    // ২. ট্রেইনার অ্যাপ্লিকেশন সাবমিশন (Logic Updated)
    app.post("/api/trainer-application", async (req, res) => {
      try {
        const { email } = req.body;
        const existing = await trainerCollection.findOne({ email });

        // যদি অলরেডি পেন্ডিং থাকে, তবে রিজেক্ট করুন
        if (existing && existing.status === "Pending") {
          return res
            .status(400)
            .json({ error: "Already applied. Please wait." });
        }

        // যদি রিজেক্টেড হয়, আগেরটি ডিলিট করে নতুনটা ইনসার্ট করুন
        if (existing && existing.status === "Rejected") {
          await trainerCollection.deleteOne({ email });
        }

        const application = {
          ...req.body,
          status: "Pending",
          appliedAt: new Date(),
        };
        const result = await trainerCollection.insertOne(application);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ error: "Server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (err) {
    console.error(err);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
