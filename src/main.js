import { Client, Databases, Messaging, ID } from "node-appwrite"

// This Appwrite function will be executed every time your function is triggered
export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY)

  const databases = new Databases(client)
  const messaging = new Messaging(client)

  try {
    // Parse request body
    let data
    try {
      data = typeof req.body === "string" ? JSON.parse(req.body) : req.body
      log(`Received data: ${JSON.stringify(data)}`)
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

    log(`Sending notification: "${title}" - "${body}"`)

    // Get all push targets
    log("Fetching push targets...")
    const targetsResponse = await messaging.listTargets()
    log(`Total targets found: ${targetsResponse.total}`)

    const pushTargets = targetsResponse.targets.filter((target) => target.providerType === "push")
    log(`Push targets found: ${pushTargets.length}`)

    if (pushTargets.length === 0) {
      log("No push targets available")
      return res.json({
        success: false,
        error: "No push targets found",
        targetCount: 0,
      })
    }

    // Log target details for debugging
    pushTargets.forEach((target, index) => {
      log(`Target ${index + 1}: ID=${target.$id}, User=${target.userId || "N/A"}`)
    })

    let targetIds = []

    if (audience === "all" || !audience) {
      targetIds = pushTargets.map((target) => target.$id)
      log(`Sending to all targets: ${targetIds.length}`)
    } else if (audience === "specific" && userIds && userIds.length > 0) {
      targetIds = pushTargets.filter((target) => userIds.includes(target.userId)).map((target) => target.$id)
      log(`Sending to specific users: ${targetIds.length}`)
    } else {
      // For other audience types, send to all for now
      targetIds = pushTargets.map((target) => target.$id)
      log(`Sending to audience "${audience}": ${targetIds.length}`)
    }

    if (targetIds.length === 0) {
      log("No matching targets found")
      return res.json({
        success: false,
        error: "No matching targets found for audience",
        targetCount: 0,
      })
    }

    log(`Final target IDs: ${JSON.stringify(targetIds)}`)

    // Create the push notification
    const messageId = ID.unique()
    log(`Creating push notification with ID: ${messageId}`)

    const messageResponse = await messaging.createPush(
      messageId,
      title,
      body,
      [], // topics
      [], // users
      targetIds, // targets
      {
        type: type || "general",
        timestamp: new Date().toISOString(),
        audience: audience || "all",
        ...customData,
      },
    )

    log(`Push notification created successfully: ${messageResponse.$id}`)

    // Store notification in database
    try {
      const notificationDoc = await databases.createDocument(
        process.env.APPWRITE_DATABASE_ID,
        "notifications",
        ID.unique(),
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
      log(`Warning: Database storage failed: ${dbError.message}`)
      // Don't fail the whole operation if database storage fails
    }

    return res.json({
      success: true,
      messageId: messageResponse.$id,
      targetCount: targetIds.length,
      message: `Notification sent successfully to ${targetIds.length} devices`,
      targets: targetIds,
    })
  } catch (err) {
    error("Failed to send push notification: " + err.message)
    log("Error details: " + JSON.stringify(err))
    log("Error stack: " + err.stack)

    return res.json({
      success: false,
      error: err.message,
      details: err.toString(),
      targetCount: 0,
    })
  }
}
