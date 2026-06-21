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

    // user overview page
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

    // // ২. অ্যাডমিন প্যানেলে ট্রেইনার অ্যাপ্রুভ করার জন্য এই রাউটটি যোগ করুন
    // app.patch("/api/approve-trainer/:email", async (req, res) => {
    //   const email = req.params.email;
    //   // ট্রেইনার স্ট্যাটাস আপডেট
    //   await trainerCollection.updateOne(
    //     { email },
    //     { $set: { status: "Approved" } },
    //   );
    //   // ইউজারের রোল আপডেট
    //   await userCollection.updateOne({ email }, { $set: { role: "trainer" } });
    //   res.send({ message: "Role updated to trainer" });
    // });

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

    // ২. ইউজারের স্ট্যাটাস চেক (Booking & Favorite)
    app.get("/api/user-class-status", async (req, res) => {
      try {
        const { email, classId } = req.query;

        // Bookings collection থেকে চেক
        const booking = await bookingCollection.findOne({ email, classId });
        // Favorites collection থেকে চেক
        const favorite = await favoritesCollection.findOne({ email, classId });

        res.send({
          isBooked: !!booking,
          isFavorited: !!favorite,
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to check status" });
      }
    });

    // ৩. ফেভারিট টগল করা (Add / Remove)
    app.post("/api/favorites/toggle", async (req, res) => {
      try {
        const { email, classId, classData } = req.body;
        const query = { email, classId };

        const existing = await favoritesCollection.findOne(query);

        if (existing) {
          await favoritesCollection.deleteOne(query);
          return res.send({
            status: "removed",
            message: "Removed from favorites",
          });
        } else {
          await favoritesCollection.insertOne({
            email,
            classId,
            classData,
            addedAt: new Date(),
          });
          return res.send({
            status: "added",
            message: "Successfully added to your favorites!",
          });
        }
      } catch (error) {
        res.status(500).send({ error: "Failed to toggle favorite" });
      }
    });

    //classes api

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

    //get id api
    // সিঙ্গেল ক্লাসের ডিটেইলস আনার API
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

    // post api
    app.post("/api/classes", async (req, res) => {
      const newClass = req.body;
      const result = await classesCollection.insertOne(newClass);
      res.send(result);
    });

    // Update Status
    app.patch("/api/classes/status/:id", async (req, res) => {
      const result = await classesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } },
      );
      res.send(result);
    });

    // Delete
    app.delete("/api/classes/:id", async (req, res) => {
      const result = await classesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
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
