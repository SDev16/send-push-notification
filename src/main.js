import { Client, Databases, Messaging } from "node-appwrite"

// This Appwrite function will be executed every time your function is triggered
export default async ({ req, res, log, error }) => {
  // You can use the Appwrite SDK to interact with other services
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers["x-appwrite-key"] ?? "standard_44c5b57b3d88f7f582e69a68063a8b095927f65ea58ec085a329f9e824f7c2d0536f147783bc3699042137d5c76a9117372ef2d83e43b55e7a3c5f99139847cab2a07c0c85a47f95b242ac3718c824fb0c4ac9f16dfcabeebaa2a207639bd2f8bc919d399abc8e51ea5b1c48172f8ad6234adf0fa4148bec1d2a054d830ef266")

  const databases = new Databases(client)
  const messaging = new Messaging(client)

  try {
    // Parse request body
    let data
    try {
      data = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    } catch (parseError) {
      error("Invalid JSON in request body: " + parseError.message)
      return res.json({
        success: false,
        error: "Invalid JSON in request body",
      })
    }

    const { title, body, type, audience, userIds, data: customData } = data

    // Validate required fields
    if (!title || !body) {
      error("Missing required fields: title and body")
      return res.json({
        success: false,
        error: "Missing required fields: title and body",
      })
    }

    log(`Sending notification: ${title}`)

    // Generate unique message ID
    const messageId = `push-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    log(`Generated messageId: ${messageId}`)

    // Get all push targets from Appwrite
    const targetsResponse = await messaging.listTargets()
    const pushTargets = targetsResponse.targets.filter((target) => target.providerType === "push")

    log(`Found ${pushTargets.length} push targets`)

    if (pushTargets.length === 0) {
      log("No push targets found")
      return res.json({
        success: false,
        error: "No push targets found",
        targetCount: 0,
      })
    }

    let targetIds = []

    if (audience === "all") {
      // Send to all push targets
      targetIds = pushTargets.map((target) => target.$id)
      log(`Sending to all ${targetIds.length} targets`)
    } else if (audience === "specific" && userIds && userIds.length > 0) {
      // Filter targets by user IDs
      targetIds = pushTargets.filter((target) => userIds.includes(target.userId)).map((target) => target.$id)
      log(`Sending to ${targetIds.length} specific user targets`)
    } else {
      // Get user IDs based on audience type
      const filteredUserIds = await getUserIdsByAudience(databases, audience, log, error)
      targetIds = pushTargets.filter((target) => filteredUserIds.includes(target.userId)).map((target) => target.$id)
      log(`Sending to ${targetIds.length} filtered targets for audience: ${audience}`)
    }

    if (targetIds.length === 0) {
      log("No matching targets found for audience")
      return res.json({
        success: false,
        error: "No matching targets found for audience",
        targetCount: 0,
      })
    }

    // Prepare notification data
    const notificationData = {
      type: type || "general",
      timestamp: new Date().toISOString(),
      ...customData,
    }

    log(`Sending push notification with messageId: ${messageId}`)
    log(`Target IDs: ${JSON.stringify(targetIds)}`)
    log(`Notification data: ${JSON.stringify(notificationData)}`)

    // Send push notification to targets
    const messageResponse = await messaging.createPush(
      messageId, // Required messageId parameter
      title,
      body,
      [], // topics (empty array for no topics)
      [], // users (empty array to use targets instead)
      targetIds, // specific targets
      notificationData, // data payload
      null, // action
      null, // image
      null, // icon
      null, // sound
      null, // color
      null, // tag
      null, // badge
      false, // draft
      null, // scheduledAt
    )

    log(`Push notification sent successfully: ${messageResponse.$id}`)

    // Store notification in database for user notification page
    try {
      const notificationDoc = await databases.createDocument(
        process.env.APPWRITE_FUNCTION_PROJECT_ID, // Use project ID as database ID
        "68329870001b5e1e2de7", // your notifications collection ID
        `notification-${Date.now()}`,
        {
          title: title,
          body: body,
          type: type || "general",
          sentBy: "Admin",
          sentById: "admin",
          isGlobal: true,
          sentAt: new Date().toISOString(),
          targetCount: targetIds.length,
          messageId: messageResponse.$id,
          audience: audience || "all",
        },
      )
      log(`Notification stored in database: ${notificationDoc.$id}`)
    } catch (dbError) {
      log(`Warning: Failed to store notification in database: ${dbError.message}`)
      // Don't fail the entire operation if database storage fails
    }

    return res.json({
      success: true,
      messageId: messageResponse.$id,
      targetCount: targetIds.length,
      targets: targetIds,
      message: `Notification sent to ${targetIds.length} devices`,
    })
  } catch (err) {
    error("Failed to send push notification: " + err.message)
    log("Full error details: " + JSON.stringify(err))
    return res.json({
      success: false,
      error: err.message,
      targetCount: 0,
    })
  }
}

async function getUserIdsByAudience(databases, audience, log, error) {
  try {
    const queries = []

    if (audience === "active_users") {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      queries.push(`greaterThan("lastLoginAt", "${weekAgo.toISOString()}")`)
    } else if (audience === "recent_orders") {
      const monthAgo = new Date()
      monthAgo.setDate(monthAgo.getDate() - 30)
      queries.push(`greaterThan("lastOrderAt", "${monthAgo.toISOString()}")`)
    }

    const response = await databases.listDocuments(
      process.env.APPWRITE_FUNCTION_PROJECT_ID, // Use project ID as database ID
      "682956fa0020a257bab8", // users collection
      queries,
    )

    log(`Found ${response.documents.length} users for audience: ${audience}`)
    return response.documents.map((doc) => doc.$id)
  } catch (err) {
    error("Error getting user IDs: " + err.message)
    return []
  }
}
